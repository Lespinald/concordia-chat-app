use std::{env, net::SocketAddr, sync::Arc, time::Duration};

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{delete, get, post},
    Json, Router,
};
use rdkafka::{
    config::ClientConfig,
    producer::{FutureProducer, FutureRecord},
    util::Timeout,
};
use scylla::{frame::value::CqlTimeuuid, Session, SessionBuilder};
use serde::Deserialize;
use serde_json::{json, Value};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};
use uuid::Uuid;

// ── shared state ─────────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    db: Arc<Session>,
    producer: FutureProducer,
}

// ── request types ─────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct SendBody {
    content: String,
}

#[derive(Deserialize)]
struct ListQuery {
    limit: Option<i32>,
    before: Option<String>,
}

// ── helpers ───────────────────────────────────────────────────────────────────

fn user_id_from_headers(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-user-id")
        .and_then(|v| v.to_str().ok())
        .map(String::from)
}

fn new_timeuuid() -> Uuid {
    Uuid::now_v1(&[1, 2, 3, 4, 5, 6])
}

/// Extract an ISO-8601 timestamp from the time component of a UUIDv1 / timeuuid.
fn timeuuid_to_iso(id: Uuid) -> String {
    if let Some(ts) = id.get_timestamp() {
        let (secs, nanos) = ts.to_unix();
        if let Some(dt) = chrono::DateTime::from_timestamp(secs as i64, nanos) {
            return dt.to_rfc3339();
        }
    }
    chrono::Utc::now().to_rfc3339()
}

fn api_err(code: StatusCode, msg: &str) -> (StatusCode, Json<Value>) {
    (code, Json(json!({ "error": msg })))
}

// ── Cassandra bootstrap ───────────────────────────────────────────────────────

/// Retry connecting to Cassandra with exponential backoff (max 30 s).
async fn cassandra_connect(hosts: &[&str]) -> Session {
    let mut wait = Duration::from_secs(2);
    loop {
        match SessionBuilder::new().known_nodes(hosts).build().await {
            Ok(s) => {
                tracing::info!("Cassandra connected");
                return s;
            }
            Err(e) => {
                tracing::warn!("Cassandra not ready ({e}), retrying in {wait:?}");
                tokio::time::sleep(wait).await;
                wait = (wait * 2).min(Duration::from_secs(30));
            }
        }
    }
}

/// Create keyspace and messages table if they do not already exist.
async fn ensure_schema(db: &Session) -> anyhow::Result<()> {
    db.query(
        "CREATE KEYSPACE IF NOT EXISTS discord_chat \
         WITH replication = {'class':'SimpleStrategy','replication_factor':1}",
        &[],
    )
    .await?;

    db.query(
        "CREATE TABLE IF NOT EXISTS discord_chat.messages ( \
            channel_id uuid, \
            message_id timeuuid, \
            author_id  uuid, \
            content    text, \
            PRIMARY KEY (channel_id, message_id) \
         ) WITH CLUSTERING ORDER BY (message_id DESC)",
        &[],
    )
    .await?;

    Ok(())
}

// ── main ──────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(tracing_subscriber::fmt::layer())
        .init();

    dotenvy::dotenv().ok();

    let hosts_raw =
        env::var("CASSANDRA_HOSTS").unwrap_or_else(|_| "127.0.0.1:9042".into());
    let kafka_brokers =
        env::var("KAFKA_BROKERS").unwrap_or_else(|_| "localhost:9092".into());
    let port: u16 = env::var("CHAT_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8083);

    let hosts: Vec<&str> = hosts_raw.split(',').collect();

    let db = cassandra_connect(&hosts).await;
    ensure_schema(&db).await?;
    db.use_keyspace("discord_chat", false).await?;
    tracing::info!("Cassandra schema ready");

    // Kafka producer — connection errors are logged but do not abort startup.
    let producer: FutureProducer = ClientConfig::new()
        .set("bootstrap.servers", &kafka_brokers)
        .set("message.timeout.ms", "5000")
        .create()?;

    let state = AppState {
        db: Arc::new(db),
        producer,
    };

    let app = Router::new()
        .route("/health", get(health))
        .route(
            "/channels/:channel_id/messages",
            post(send_message).get(list_messages),
        )
        .route(
            "/channels/:channel_id/messages/:message_id",
            delete(delete_message),
        )
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("Chat service listening on http://{}", addr);
    axum::serve(listener, app).await?;

    Ok(())
}

// ── handlers ──────────────────────────────────────────────────────────────────

async fn health() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}

/// POST /channels/:channel_id/messages  →  201 with message object
async fn send_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(channel_id): Path<String>,
    Json(body): Json<SendBody>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let user_id_str = user_id_from_headers(&headers)
        .ok_or_else(|| api_err(StatusCode::UNAUTHORIZED, "unauthorized"))?;

    if body.content.trim().is_empty() {
        return Err(api_err(StatusCode::BAD_REQUEST, "content is required"));
    }

    let channel_uuid = Uuid::parse_str(&channel_id)
        .map_err(|_| api_err(StatusCode::BAD_REQUEST, "invalid channel_id"))?;
    let author_uuid = Uuid::parse_str(&user_id_str)
        .map_err(|_| api_err(StatusCode::BAD_REQUEST, "invalid user_id"))?;

    let msg_uuid = new_timeuuid();
    let timeuuid = CqlTimeuuid::from(msg_uuid);
    let created_at = timeuuid_to_iso(msg_uuid);

    state
        .db
        .query(
            "INSERT INTO messages (channel_id, message_id, author_id, content) \
             VALUES (?, ?, ?, ?)",
            (channel_uuid, timeuuid, author_uuid, body.content.as_str()),
        )
        .await
        .map_err(|e| {
            tracing::error!("Cassandra insert: {e}");
            api_err(StatusCode::INTERNAL_SERVER_ERROR, "db error")
        })?;

    // Fire-and-forget Kafka event — failure does not fail the request.
    let payload = json!({
        "message_id":  msg_uuid.to_string(),
        "channel_id":  channel_id,
        "author_id":   user_id_str,
        "content":     body.content,
        "attachments": [],
        "created_at":  created_at,
    })
    .to_string();

    let record = FutureRecord::to("message-created")
        .key(channel_id.as_str())
        .payload(payload.as_bytes());

    if let Err((e, _)) = state
        .producer
        .send(record, Timeout::After(Duration::from_secs(5)))
        .await
    {
        tracing::warn!("Kafka publish failed: {e}");
    }

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "message_id": msg_uuid.to_string(),
            "channel_id": channel_id,
            "author_id":  user_id_str,
            "content":    body.content,
            "created_at": created_at,
        })),
    ))
}

/// GET /channels/:channel_id/messages?limit=50&before=<timeuuid>
///
/// Returns messages ordered newest-first (matches Cassandra clustering order).
/// The frontend reverses the array for chronological display.
/// Pagination: pass the oldest message_id as `before` to fetch older pages.
async fn list_messages(
    State(state): State<AppState>,
    Path(channel_id): Path<String>,
    Query(params): Query<ListQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let channel_uuid = Uuid::parse_str(&channel_id)
        .map_err(|_| api_err(StatusCode::BAD_REQUEST, "invalid channel_id"))?;

    let limit = params.limit.unwrap_or(50).clamp(1, 100);
    // Fetch one extra to detect whether a next page exists.
    let fetch_limit = limit + 1;

    let qr = if let Some(ref before) = params.before {
        let before_uuid = Uuid::parse_str(before)
            .map_err(|_| api_err(StatusCode::BAD_REQUEST, "invalid before cursor"))?;
        let before_ts = CqlTimeuuid::from(before_uuid);
        state
            .db
            .query(
                "SELECT message_id, author_id, content FROM messages \
                 WHERE channel_id = ? AND message_id < ? LIMIT ?",
                (channel_uuid, before_ts, fetch_limit),
            )
            .await
    } else {
        state
            .db
            .query(
                "SELECT message_id, author_id, content FROM messages \
                 WHERE channel_id = ? LIMIT ?",
                (channel_uuid, fetch_limit),
            )
            .await
    }
    .map_err(|e| {
        tracing::error!("Cassandra select: {e}");
        api_err(StatusCode::INTERNAL_SERVER_ERROR, "db error")
    })?;

    let all: Vec<(CqlTimeuuid, Uuid, String)> = qr
        .rows_typed::<(CqlTimeuuid, Uuid, String)>()
        .map_err(|e| {
            tracing::error!("Row type mismatch: {e}");
            api_err(StatusCode::INTERNAL_SERVER_ERROR, "parse error")
        })?
        .collect::<Result<_, _>>()
        .map_err(|e| {
            tracing::error!("Row deserialize: {e}");
            api_err(StatusCode::INTERNAL_SERVER_ERROR, "parse error")
        })?;

    let has_more = all.len() as i32 > limit;
    let display = if has_more { &all[..limit as usize] } else { &all[..] };

    let mut messages: Vec<Value> = Vec::with_capacity(display.len());

    for (msg_ts, author_id, content) in display {
        let msg_uuid = Uuid::from(*msg_ts);
        messages.push(json!({
            "message_id": msg_uuid.to_string(),
            "channel_id": channel_id,
            "author_id":  author_id.to_string(),
            "content":    content,
            "created_at": timeuuid_to_iso(msg_uuid),
        }));
    }

    // Cursor points at the oldest message in this page (last in DESC result).
    let next_cursor: Option<String> = if has_more {
        messages.last().and_then(|m| m["message_id"].as_str()).map(String::from)
    } else {
        None
    };

    Ok(Json(json!({
        "messages":    messages,
        "next_cursor": next_cursor,
        "has_more":    has_more,
    })))
}

/// DELETE /channels/:channel_id/messages/:message_id  →  204
///
/// Only the message author may delete. Returns 403 for other users, 404 if absent.
async fn delete_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((channel_id, message_id)): Path<(String, String)>,
) -> Result<StatusCode, (StatusCode, Json<Value>)> {
    let user_id_str = user_id_from_headers(&headers)
        .ok_or_else(|| api_err(StatusCode::UNAUTHORIZED, "unauthorized"))?;

    let channel_uuid = Uuid::parse_str(&channel_id)
        .map_err(|_| api_err(StatusCode::BAD_REQUEST, "invalid channel_id"))?;
    let msg_uuid = Uuid::parse_str(&message_id)
        .map_err(|_| api_err(StatusCode::BAD_REQUEST, "invalid message_id"))?;
    let author_uuid = Uuid::parse_str(&user_id_str)
        .map_err(|_| api_err(StatusCode::BAD_REQUEST, "invalid user_id"))?;

    let timeuuid = CqlTimeuuid::from(msg_uuid);

    // Fetch the row to verify ownership before deleting.
    let qr = state
        .db
        .query(
            "SELECT author_id FROM messages WHERE channel_id = ? AND message_id = ?",
            (channel_uuid, timeuuid.clone()),
        )
        .await
        .map_err(|e| {
            tracing::error!("Cassandra fetch for delete: {e}");
            api_err(StatusCode::INTERNAL_SERVER_ERROR, "db error")
        })?;

    let (stored_author,) = qr
        .single_row_typed::<(Uuid,)>()
        .map_err(|_| api_err(StatusCode::NOT_FOUND, "message not found"))?;

    if stored_author != author_uuid {
        return Err(api_err(StatusCode::FORBIDDEN, "forbidden"));
    }

    state
        .db
        .query(
            "DELETE FROM messages WHERE channel_id = ? AND message_id = ?",
            (channel_uuid, timeuuid),
        )
        .await
        .map_err(|e| {
            tracing::error!("Cassandra delete: {e}");
            api_err(StatusCode::INTERNAL_SERVER_ERROR, "db error")
        })?;

    Ok(StatusCode::NO_CONTENT)
}
