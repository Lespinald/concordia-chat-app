use std::{collections::HashMap, env, net::SocketAddr, sync::Arc, time::Duration};

use axum::{
    extract::{Multipart, Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{delete, get, post},
    Json, Router,
};
use aws_sdk_s3::{
    config::{BehaviorVersion, Credentials, Region},
    primitives::ByteStream,
    Client as S3Client,
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

#[derive(Clone)]
struct AppState {
    db: Arc<Session>,
    producer: FutureProducer,
    s3: Arc<S3Client>,
    minio_public_url: String,
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

fn username_from_headers(headers: &HeaderMap) -> String {
    headers
        .get("x-username")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string()
}

fn new_timeuuid() -> Uuid {
    Uuid::now_v1(&[1, 2, 3, 4, 5, 6])
}

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
            username   text, \
            content    text, \
            PRIMARY KEY (channel_id, message_id) \
         ) WITH CLUSTERING ORDER BY (message_id DESC)",
        &[],
    )
    .await?;

    // Add username column to tables created before this migration.
    let _ = db
        .query("ALTER TABLE discord_chat.messages ADD username text", &[])
        .await;

    // Username lookup cache: populated on every send_message so historical
    // messages can be resolved even if they pre-date the username column.
    db.query(
        "CREATE TABLE IF NOT EXISTS discord_chat.user_cache ( \
            user_id  uuid PRIMARY KEY, \
            username text \
         )",
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
    let minio_url =
        env::var("MINIO_URL").unwrap_or_else(|_| "http://minio:9000".into());
    let minio_public_url =
        env::var("MINIO_PUBLIC_URL").unwrap_or_else(|_| "http://localhost:9000".into());
    let minio_access =
        env::var("MINIO_ACCESS_KEY").unwrap_or_else(|_| "minioadmin".into());
    let minio_secret =
        env::var("MINIO_SECRET_KEY").unwrap_or_else(|_| "minioadmin".into());

    let hosts: Vec<&str> = hosts_raw.split(',').collect();

    let db = cassandra_connect(&hosts).await;
    ensure_schema(&db).await?;
    db.use_keyspace("discord_chat", false).await?;
    tracing::info!("Cassandra schema ready");

    let producer: FutureProducer = ClientConfig::new()
        .set("bootstrap.servers", &kafka_brokers)
        .set("message.timeout.ms", "5000")
        .create()?;

    let s3_config = aws_sdk_s3::Config::builder()
        .behavior_version(BehaviorVersion::latest())
        .endpoint_url(&minio_url)
        .region(Region::new("us-east-1"))
        .credentials_provider(Credentials::new(
            &minio_access,
            &minio_secret,
            None,
            None,
            "minio",
        ))
        .force_path_style(true)
        .build();
    let s3 = Arc::new(S3Client::from_conf(s3_config));

    let state = AppState {
        db: Arc::new(db),
        producer,
        s3,
        minio_public_url,
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
        .route(
            "/channels/:channel_id/attachments",
            post(upload_attachment),
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

async fn send_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(channel_id): Path<String>,
    Json(body): Json<SendBody>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let user_id_str = user_id_from_headers(&headers)
        .ok_or_else(|| api_err(StatusCode::UNAUTHORIZED, "unauthorized"))?;
    let username = username_from_headers(&headers);

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

    // Store NULL when username is missing so list_messages can fall back to user_cache.
    let username_stored: Option<&str> = if username.is_empty() { None } else { Some(&username) };
    state
        .db
        .query(
            "INSERT INTO messages (channel_id, message_id, author_id, username, content) \
             VALUES (?, ?, ?, ?, ?)",
            (channel_uuid, timeuuid, author_uuid, username_stored, body.content.as_str()),
        )
        .await
        .map_err(|e| {
            tracing::error!("Cassandra insert: {e}");
            api_err(StatusCode::INTERNAL_SERVER_ERROR, "db error")
        })?;

    // Update user_cache so historical messages from this user can resolve their name.
    if !username.is_empty() {
        let _ = state
            .db
            .query(
                "INSERT INTO user_cache (user_id, username) VALUES (?, ?)",
                (author_uuid, username.as_str()),
            )
            .await;
    }

    let payload = json!({
        "message_id":  msg_uuid.to_string(),
        "channel_id":  channel_id,
        "author_id":   user_id_str,
        "username":    username,
        "content":     body.content,
        "attachments": [],
        "created_at":  created_at,
    })
    .to_string();

    let producer = state.producer.clone();
    let payload_owned = payload.clone();
    let channel_key = channel_id.clone();
    tokio::spawn(async move {
        let record = FutureRecord::to("message-created")
            .key(channel_key.as_str())
            .payload(payload_owned.as_bytes());
        if let Err((e, _)) = producer
            .send(record, Timeout::After(Duration::from_secs(5)))
            .await
        {
            tracing::warn!("Kafka publish failed: {e}");
        }
    });

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "message_id": msg_uuid.to_string(),
            "channel_id": channel_id,
            "author_id":  user_id_str,
            "username":   username,
            "content":    body.content,
            "created_at": created_at,
        })),
    ))
}

async fn list_messages(
    State(state): State<AppState>,
    Path(channel_id): Path<String>,
    Query(params): Query<ListQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let channel_uuid = Uuid::parse_str(&channel_id)
        .map_err(|_| api_err(StatusCode::BAD_REQUEST, "invalid channel_id"))?;

    let limit = params.limit.unwrap_or(50).clamp(1, 100);
    let fetch_limit = limit + 1;

    let qr = if let Some(ref before) = params.before {
        let before_uuid = Uuid::parse_str(before)
            .map_err(|_| api_err(StatusCode::BAD_REQUEST, "invalid before cursor"))?;
        let before_ts = CqlTimeuuid::from(before_uuid);
        state
            .db
            .query(
                "SELECT message_id, author_id, username, content FROM messages \
                 WHERE channel_id = ? AND message_id < ? LIMIT ?",
                (channel_uuid, before_ts, fetch_limit),
            )
            .await
    } else {
        state
            .db
            .query(
                "SELECT message_id, author_id, username, content FROM messages \
                 WHERE channel_id = ? LIMIT ?",
                (channel_uuid, fetch_limit),
            )
            .await
    }
    .map_err(|e| {
        tracing::error!("Cassandra select: {e}");
        api_err(StatusCode::INTERNAL_SERVER_ERROR, "db error")
    })?;

    let all: Vec<(CqlTimeuuid, Uuid, Option<String>, String)> = qr
        .rows_typed::<(CqlTimeuuid, Uuid, Option<String>, String)>()
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

    // Collect author_ids whose username is missing from the message row.
    // These are messages inserted before the username column was added.
    let missing_ids: Vec<Uuid> = display
        .iter()
        .filter(|(_, _, username, _)| username.is_none())
        .map(|(_, author_id, _, _)| *author_id)
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    // Resolve missing usernames from the persistent user_cache.
    let mut name_cache: HashMap<Uuid, String> = HashMap::new();
    for author_id in missing_ids {
        if let Ok(qr) = state
            .db
            .query(
                "SELECT username FROM user_cache WHERE user_id = ?",
                (author_id,),
            )
            .await
        {
            if let Ok(Some((name,))) = qr.maybe_first_row_typed::<(String,)>() {
                name_cache.insert(author_id, name);
            }
        }
    }

    let mut messages: Vec<Value> = Vec::with_capacity(display.len());
    for (msg_ts, author_id, username, content) in display {
        let msg_uuid = Uuid::from(*msg_ts);
        // Treat stored empty-string the same as NULL — fall back to user_cache.
        let resolved = username
            .clone()
            .filter(|s| !s.is_empty())
            .or_else(|| name_cache.get(author_id).cloned());

        messages.push(json!({
            "message_id": msg_uuid.to_string(),
            "channel_id": channel_id,
            "author_id":  author_id.to_string(),
            "username":   resolved,
            "content":    content,
            "created_at": timeuuid_to_iso(msg_uuid),
        }));
    }

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

async fn upload_attachment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(channel_id): Path<String>,
    mut multipart: Multipart,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    user_id_from_headers(&headers)
        .ok_or_else(|| api_err(StatusCode::UNAUTHORIZED, "unauthorized"))?;

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        api_err(StatusCode::BAD_REQUEST, &format!("multipart: {e}"))
    })? {
        if field.name() != Some("file") {
            continue;
        }

        let filename = field
            .file_name()
            .map(|s| s.replace(['/', '\\', '\0'], "_"))
            .unwrap_or_else(|| "upload".to_string());
        let content_type = field
            .content_type()
            .unwrap_or("application/octet-stream")
            .to_string();
        let data = field.bytes().await.map_err(|e| {
            api_err(StatusCode::BAD_REQUEST, &format!("read: {e}"))
        })?;

        let key = format!("{}/{}/{}", channel_id, Uuid::new_v4(), filename);

        state
            .s3
            .put_object()
            .bucket("attachments")
            .key(&key)
            .content_type(content_type)
            .body(ByteStream::from(data))
            .send()
            .await
            .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, &format!("s3: {e}")))?;

        let url = format!("{}/attachments/{}", state.minio_public_url, key);
        return Ok(Json(json!({ "url": url })));
    }

    Err(api_err(StatusCode::BAD_REQUEST, "no file field in request"))
}
