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
    
    // 1. Unauthenticated request -> HTTP 401
    let auth_header = headers.get("authorization").and_then(|h| h.to_str().ok());
    if auth_header.is_none() || !auth_header.unwrap().starts_with("Bearer ") {
        return Err((StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthenticated"}))));
    }
    
    // Simulación: Extraemos un user_id del token JWT (se implementará el parseo real en el middleware global)
    let author_id = Uuid::new_v4();

    // 2. Call CheckPerm gRPC with action: WRITE -> HTTP 403 if false
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

    // 3. Persist in Cassandra with UUID v7
    let message_id = Uuid::now_v7();
    let content = payload.content;

    let query = "INSERT INTO messages (channel_id, message_id, author_id, content) VALUES (?, ?, ?, ?)";
    state.db.query(query, (channel_id, message_id, author_id, &content)).await.map_err(|e| {
        tracing::error!("Database insertion error: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "database error"})))
    })?;

// 4. Publish Kafka event within 1 second
    let created_at = Utc::now().to_rfc3339();
    let event = json!({
        "event": "message-created",
        "message_id": message_id,
        "channel_id": channel_id,
        "author_id": author_id,
        "content": content,
        "created_at": created_at
    });
    
    // GUARDAMOS LOS TEXTOS EN VARIABLES PARA QUE VIVAN EN LA MEMORIA
    let payload_str = event.to_string();
    let key_str = channel_id.to_string();
    
    let record = FutureRecord::to("messages.events")
        .payload(&payload_str)
        .key(&key_str);

    // Ahora Rust está feliz porque payload_str y key_str siguen vivos aquí
    let _ = state.kafka.send(record, Duration::from_secs(1)).await;

    // 5. Return HTTP 201 with message object
    let res = MessageRes {
        message_id,
        channel_id,
        author_id,
        content,
        created_at,
    };

    Ok((StatusCode::CREATED, Json(res)))
}