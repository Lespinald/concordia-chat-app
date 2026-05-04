use axum::{
    extract::{Path, State, Query},
    http::{HeaderMap, StatusCode},
    routing::{get, delete},
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

#[derive(Deserialize)]
struct PaginationParams {
    limit: Option<usize>,
    before: Option<Uuid>,
}

#[derive(Serialize)]
struct PaginatedMessagesRes {
    messages: Vec<MessageRes>,
    next_cursor: Option<Uuid>,
    has_more: bool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(tracing_subscriber::fmt::layer())
        .init();
    
    dotenvy::dotenv().ok();

    // --- Configurar Cassandra ---
    let cassandra_hosts_str = env::var("CASSANDRA_HOST").unwrap_or_else(|_| "cassandra".to_string());
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
    
    let endpoint = tonic::transport::Endpoint::from_shared(grpc_url)?;
    let auth_client = AuthClient::new(endpoint.connect_lazy());

    let shared_state = Arc::new(AppState {
        db: session,
        kafka: kafka_producer,
        auth_client,
    });

    // --- CORRECCIÓN DEL ROUTER ---
    let app = Router::new()
        .route("/health", get(health_check))
        .route("/channels/:channel_id/messages", get(get_messages).post(create_message))
        .route("/channels/:channel_id/messages/:message_id", delete(delete_message))
        .with_state(shared_state); // Se llama UNA sola vez al final

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

// === LÓGICA TICKET T-27 ===
async fn create_message(
    State(state): State<Arc<AppState>>,
    Path(channel_id): Path<Uuid>,
    headers: HeaderMap,
    Json(payload): Json<CreateMessageReq>,
) -> Result<(StatusCode, Json<MessageRes>), (StatusCode, Json<Value>)> {
    
    let auth_header = headers.get("authorization").and_then(|h| h.to_str().ok());
    if auth_header.is_none() || !auth_header.unwrap().starts_with("Bearer ") {
        return Err((StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthenticated"}))));
    }
    
    let author_id = Uuid::new_v4();

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

    let message_id = Uuid::now_v7();
    let content = payload.content;

    let query = "INSERT INTO messages (channel_id, message_id, author_id, content) VALUES (?, ?, ?, ?)";
    state.db.query(query, (channel_id, message_id, author_id, &content)).await.map_err(|e| {
        tracing::error!("Database insertion error: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "database error"})))
    })?;

    let created_at = Utc::now().to_rfc3339();
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
    
    let record = FutureRecord::to("messages.events")
        .payload(&payload_str)
        .key(&key_str);

    let _ = state.kafka.send(record, Duration::from_secs(1)).await;

    let res = MessageRes {
        message_id,
        channel_id,
        author_id,
        content,
        created_at,
    };

    Ok((StatusCode::CREATED, Json(res)))
}

// === LÓGICA TICKET T-28 (Actualizado para T-29) ===
async fn get_messages(
    State(state): State<Arc<AppState>>,
    Path(channel_id): Path<Uuid>,
    Query(params): Query<PaginationParams>,
    headers: HeaderMap,
) -> Result<(StatusCode, Json<PaginatedMessagesRes>), (StatusCode, Json<Value>)> {
    
    let auth_header = headers.get("authorization").and_then(|h| h.to_str().ok());
    if auth_header.is_none() || !auth_header.unwrap().starts_with("Bearer ") {
        return Err((StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthenticated"}))));
    }
    
    let user_id = Uuid::new_v4();

    let mut client = state.auth_client.clone();
    let perm_req = tonic::Request::new(CheckPermRequest {
        user_id: user_id.to_string(),
        channel_id: channel_id.to_string(),
        action: "READ".to_string(),
    });

    let perm_res = client.check_perm(perm_req).await.map_err(|e| {
        tracing::error!("gRPC error: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "auth service unavailable"})))
    })?;

    if !perm_res.into_inner().allowed {
        return Err((StatusCode::FORBIDDEN, Json(json!({"error": "insufficient permissions"}))));
    }

    let limit = params.limit.unwrap_or(50);
    let query_limit = (limit + 1) as i32; 

    // CORRECCIÓN: Código de BD fusionado correctamente aquí
    let query_result = if let Some(before_id) = params.before {
        let q = "SELECT message_id, author_id, content, deleted_at FROM messages WHERE channel_id = ? AND message_id < ? ORDER BY message_id DESC LIMIT ?";
        state.db.query(q, (channel_id, before_id, query_limit)).await
    } else {
        let q = "SELECT message_id, author_id, content, deleted_at FROM messages WHERE channel_id = ? ORDER BY message_id DESC LIMIT ?";
        state.db.query(q, (channel_id, query_limit)).await
    };

    let rows = query_result.map_err(|e| {
        tracing::error!("Database read error: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "database error"})))
    })?.rows.unwrap_or_default();

    let mut messages = Vec::new();
    for row in rows {
        // Obtenemos deleted_at
        let (msg_id, auth_id, text, deleted_at): (Uuid, Uuid, String, Option<String>) = row.into_typed().map_err(|_| {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "data mapping error"})))
        })?;

        // Saltamos los mensajes borrados
        if deleted_at.is_some() {
            continue;
        }

        messages.push(MessageRes {
            message_id: msg_id,
            channel_id,
            author_id: auth_id,
            content: text,
            created_at: "".to_string(), 
        });
    }

    let has_more = messages.len() > limit;
    if has_more {
        messages.pop(); 
    }

    let next_cursor = messages.last().map(|m| m.message_id);

    Ok((StatusCode::OK, Json(PaginatedMessagesRes {
        messages,
        next_cursor,
        has_more,
    })))
}

// === LÓGICA TICKET T-29 (Soft Delete) ===
async fn delete_message(
    State(state): State<Arc<AppState>>,
    Path((channel_id, message_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<StatusCode, (StatusCode, Json<Value>)> {
    
    let auth_header = headers.get("authorization").and_then(|h| h.to_str().ok());
    if auth_header.is_none() || !auth_header.unwrap().starts_with("Bearer ") {
        return Err((StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthenticated"}))));
    }

    let requester_id = headers.get("x-user-id")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| Uuid::parse_str(s).ok())
        .unwrap_or_else(Uuid::new_v4);

    let q_fetch = "SELECT author_id, deleted_at FROM messages WHERE channel_id = ? AND message_id = ?";
    let row = state.db.query(q_fetch, (channel_id, message_id)).await.map_err(|e| {
        tracing::error!("Database read error: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "database error"})))
    })?.rows.unwrap_or_default().into_iter().next();

    let (author_id, deleted_at) = match row {
        Some(r) => r.into_typed::<(Uuid, Option<String>)>().map_err(|_| {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "data mapping error"})))
        })?,
        None => return Err((StatusCode::NOT_FOUND, Json(json!({"error": "message not found"})))),
    };

    if deleted_at.is_some() {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "message not found"}))));
    }

    if requester_id != author_id {
        let mut client = state.auth_client.clone();
        let perm_req = tonic::Request::new(CheckPermRequest {
            user_id: requester_id.to_string(),
            channel_id: channel_id.to_string(),
            action: "MANAGE".to_string(),
        });

        let perm_res = client.check_perm(perm_req).await.map_err(|_| {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "auth service unavailable"})))
        })?;

        if !perm_res.into_inner().allowed {
            return Err((StatusCode::FORBIDDEN, Json(json!({"error": "insufficient permissions"}))));
        }
    }

    let now = Utc::now().to_rfc3339();
    let q_update = "UPDATE messages SET deleted_at = ? WHERE channel_id = ? AND message_id = ?";
    
    state.db.query(q_update, (now, channel_id, message_id)).await.map_err(|e| {
        tracing::error!("Database update error: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "database update error"})))
    })?;

    Ok(StatusCode::NO_CONTENT)
}