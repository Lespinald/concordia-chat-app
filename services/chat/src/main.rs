use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use rdkafka::{
    producer::{FutureProducer, FutureRecord},
    ClientConfig,
};
use scylla::{Session, SessionBuilder};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{env, net::SocketAddr, sync::Arc, time::Duration};
use tonic::transport::Channel;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};
use uuid::Uuid;

// 1. Generar e importar el código del cliente gRPC
pub mod permissions {
    tonic::include_proto!("permissions");
}
use permissions::{auth_client::AuthClient, CheckPermRequest};

// 2. Extender el estado para incluir Kafka y gRPC
struct AppState {
    db: Session,
    kafka: FutureProducer,
    auth_client: AuthClient<Channel>,
}

#[derive(Deserialize)]
struct CreateMessageReq {
    content: String,
}

#[derive(Serialize)]
struct MessageRes {
    message_id: Uuid,
    channel_id: Uuid,
    author_id: Uuid,
    content: String,
    created_at: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(tracing_subscriber::fmt::layer())
        .init();
    
    dotenvy::dotenv().ok();

    // --- Configurar Cassandra ---
    let cassandra_hosts_str = env::var("CASSANDRA_HOSTS").unwrap_or_else(|_| "127.0.0.1:9042".to_string());
    let keyspace = env::var("CASSANDRA_KEYSPACE").unwrap_or_else(|_| "discord_chat".to_string());
    let hosts: Vec<&str> = cassandra_hosts_str.split(',').collect();
    tracing::info!("Connecting to Cassandra...");
    let session = SessionBuilder::new().known_nodes(&hosts).build().await?;
    session.use_keyspace(keyspace, false).await?;

    // --- Configurar Productor de Kafka ---
    let kafka_brokers = env::var("KAFKA_BROKERS").unwrap_or_else(|_| "127.0.0.1:9092".to_string());
    tracing::info!("Connecting to Kafka...");
    let kafka_producer: FutureProducer = ClientConfig::new()
        .set("bootstrap.servers", &kafka_brokers)
        .set("message.timeout.ms", "5000")
        .create()?;

// --- Configurar Cliente gRPC ---
    let grpc_url = env::var("AUTH_GRPC_URL").unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
    tracing::info!("Configuring Auth gRPC Service...");
    
    // 1. Preparamos el "Endpoint" con la URL
    let endpoint = tonic::transport::Endpoint::from_shared(grpc_url)?;
    // 2. Creamos el cliente pasándole la conexión perezosa (lazy)
    let auth_client = AuthClient::new(endpoint.connect_lazy());

    let shared_state = Arc::new(AppState {
        db: session,
        kafka: kafka_producer,
        auth_client,
    });

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/channels/:channel_id/messages", post(create_message))
        .with_state(shared_state);

    let port: u16 = env::var("CHAT_PORT").unwrap_or_else(|_| "3000".to_string()).parse().unwrap_or(3000);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    
    tracing::info!("Service started on http://{}", addr);
    axum::serve(listener, app).await?;

    Ok(())
}

async fn health_check() -> (StatusCode, Json<Value>) {
    (StatusCode::OK, Json(json!({"status": "ok"})))
}

// === LÓGICA PRINCIPAL DEL TICKET T-27 ===
async fn create_message(
    State(state): State<Arc<AppState>>,
    Path(channel_id): Path<Uuid>,
    headers: HeaderMap,
    Json(payload): Json<CreateMessageReq>,
) -> Result<(StatusCode, Json<MessageRes>), (StatusCode, Json<Value>)> {
    
    // --- SOLUCIÓN 3: Parsear el JWT ---
    let auth_header = headers.get("authorization").and_then(|h| h.to_str().ok());
    if auth_header.is_none() || !auth_header.unwrap().starts_with("Bearer ") {
        return Err((StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthenticated"}))));
    }
    
    let token = auth_header.unwrap().trim_start_matches("Bearer ");
    
    let token_data = jsonwebtoken::dangerous_insecure_decode::<serde_json::Value>(token).map_err(|e| {
        tracing::error!("Error decoding JWT: {}", e);
        (StatusCode::UNAUTHORIZED, Json(json!({"error": "invalid token"})))
    })?;

    // Buscamos el ID del usuario en el claim "sub" (estándar) o "user_id". 
    // Ajusta la clave si tu Auth Service lo guarda con otro nombre.
    let author_id_str = token_data.claims.get("sub")
        .or_else(|| token_data.claims.get("user_id")) 
        .and_then(|v| v.as_str())
        .unwrap_or_default();

    let author_id = Uuid::parse_str(author_id_str).map_err(|_| {
        (StatusCode::UNAUTHORIZED, Json(json!({"error": "invalid author_id format in token"})))
    })?;


    // --- 2. CheckPerm gRPC ---
    let mut client = state.auth_client.clone();
    let perm_req = tonic::Request::new(CheckPermRequest {
        user_id: author_id.to_string(),
        channel_id: channel_id.to_string(),
        action: "WRITE".to_string(),
    });

    let perm_res = client.check_perm(perm_req).await.map_err(|e| {
        tracing::error!("gRPC connection error: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "auth service unavailable"})))
    })?;

    if !perm_res.into_inner().allowed {
        return Err((StatusCode::FORBIDDEN, Json(json!({"error": "insufficient permissions"}))));
    }

    // --- SOLUCIÓN 1: Guardar created_at en Cassandra ---
    let message_id = Uuid::now_v7();
    let content = payload.content;
    let created_at = Utc::now().to_rfc3339(); // Movido aquí arriba

    // Agregamos created_at a la query y a los valores enlazados
    let query = "INSERT INTO messages (channel_id, message_id, author_id, content, created_at) VALUES (?, ?, ?, ?, ?)";
    state.db.query(query, (channel_id, message_id, author_id, &content, &created_at)).await.map_err(|e| {
        tracing::error!("Database insertion error: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "database error"})))
    })?;

    // --- SOLUCIÓN 2: Publicar en el Tópico Correcto ---
    let event = json!({
        "event": "message-created",
        "message_id": message_id,
        "channel_id": channel_id,
        "author_id": author_id,
        "content": content,
        "created_at": created_at
    });
    
    let payload_str = event.to_string();
    let key_str = channel_id.to_string();
    
    // Nombre del tópico corregido
    let record = FutureRecord::to("message-created")
        .payload(&payload_str)
        .key(&key_str);

    let _ = state.kafka.send(record, Duration::from_secs(1)).await;

    // --- 5. Retornar HTTP 201 ---
    let res = MessageRes {
        message_id,
        channel_id,
        author_id,
        content,
        created_at,
    };

    Ok((StatusCode::CREATED, Json(res)))
}