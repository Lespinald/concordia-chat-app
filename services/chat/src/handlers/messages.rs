use std::collections::HashSet;
use std::{sync::Arc, time::Duration};

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, TimeZone, Utc};
use once_cell::sync::Lazy;
use rdkafka::producer::{FutureProducer, FutureRecord};
use regex::Regex;
use scylla::frame::value::CqlTimestamp;
use scylla::IntoTypedRows;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    proto::{Action, CheckPermRequest},
    state::{AppState, UserCache},
};

async fn resolve_server_id(state: &AppState, channel_id: Uuid) -> Option<Uuid> {
    if let Some(sid) = state.channel_server_cache.read().await.get(&channel_id).copied() {
        return Some(sid);
    }
    let url = format!(
        "{}/internal/channels/{}",
        state.servers_http_addr.trim_end_matches('/'),
        channel_id
    );
    let resp = match state.http.get(&url).send().await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("server_id lookup failed: {}", e);
            return None;
        }
    };
    if !resp.status().is_success() {
        return None;
    }
    #[derive(Deserialize)]
    struct ChannelLookup {
        server_id: Uuid,
    }
    let body: ChannelLookup = match resp.json().await {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!("server_id decode failed: {}", e);
            return None;
        }
    };
    state
        .channel_server_cache
        .write()
        .await
        .insert(channel_id, body.server_id);
    Some(body.server_id)
}

const DEFAULT_LIMIT: i32 = 50;
const MAX_LIMIT: i32 = 100;

static MENTION_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"@([A-Za-z0-9_]{1,32})").unwrap());

#[derive(Deserialize)]
pub struct CreateMessageBody {
    pub content: String,
    #[serde(default)]
    pub attachments: Vec<String>,
}

#[derive(Serialize)]
pub struct MessageResponse {
    pub message_id: Uuid,
    pub channel_id: Uuid,
    pub author_id: Uuid,
    pub content: String,
    pub attachments: Vec<String>,
    pub created_at: DateTime<Utc>,
}

pub async fn create_message(
    State(state): State<Arc<AppState>>,
    Path(channel_id): Path<Uuid>,
    auth: AuthUser,
    Json(body): Json<CreateMessageBody>,
) -> Result<(StatusCode, Json<MessageResponse>), (StatusCode, Json<Value>)> {
    let server_id = resolve_server_id(&state, channel_id).await;
    let mut perm = state.perm.clone();
    let resp = perm
        .check_perm(CheckPermRequest {
            user_id: auth.user_id.to_string(),
            server_id: server_id.map(|s| s.to_string()).unwrap_or_default(),
            channel_id: channel_id.to_string(),
            action: Action::Write as i32,
        })
        .await
        .map_err(|e| {
            tracing::error!("CheckPerm failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "permission check failed" })),
            )
        })?
        .into_inner();

    if !resp.allowed {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "insufficient permissions" })),
        ));
    }

    let message_id = Uuid::now_v7();
    let created_at = Utc::now();

    state
        .db
        .query(
            "INSERT INTO messages (channel_id, message_id, author_id, content, attachments, created_at) \
             VALUES (?, ?, ?, ?, ?, ?)",
            (
                channel_id,
                message_id,
                auth.user_id,
                &body.content,
                &body.attachments,
                CqlTimestamp(created_at.timestamp_millis()),
            ),
        )
        .await
        .map_err(|e| {
            tracing::error!("Cassandra insert failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "failed to persist message" })),
            )
        })?;

    publish_message_created(
        &state.kafka,
        message_id,
        channel_id,
        server_id,
        auth.user_id,
        &body.content,
        &body.attachments,
        created_at,
    )
    .await;

    publish_mentions(
        &state.kafka,
        &state.user_cache,
        message_id,
        channel_id,
        server_id,
        &body.content,
        created_at,
    )
    .await;

    let push_payload = json!({
        "message_id": message_id,
        "channel_id": channel_id,
        "author_id": auth.user_id,
        "content": body.content,
        "attachments": body.attachments,
        "created_at": created_at.to_rfc3339(),
    });
    let state_clone = Arc::clone(&state);
    tokio::spawn(async move {
        fanout_new_message(state_clone, channel_id, push_payload).await;
    });

    Ok((
        StatusCode::CREATED,
        Json(MessageResponse {
            message_id,
            channel_id,
            author_id: auth.user_id,
            content: body.content,
            attachments: body.attachments,
            created_at,
        }),
    ))
}

#[derive(Deserialize)]
pub struct ListMessagesQuery {
    pub limit: Option<i32>,
    pub before: Option<Uuid>,
}

#[derive(Serialize)]
pub struct ListMessagesResponse {
    pub messages: Vec<MessageResponse>,
    pub next_cursor: Option<Uuid>,
    pub has_more: bool,
}

pub async fn list_messages(
    State(state): State<Arc<AppState>>,
    Path(channel_id): Path<Uuid>,
    Query(params): Query<ListMessagesQuery>,
    auth: AuthUser,
) -> Result<Json<ListMessagesResponse>, (StatusCode, Json<Value>)> {
    let server_id = resolve_server_id(&state, channel_id).await;
    let mut perm = state.perm.clone();
    let resp = perm
        .check_perm(CheckPermRequest {
            user_id: auth.user_id.to_string(),
            server_id: server_id.map(|s| s.to_string()).unwrap_or_default(),
            channel_id: channel_id.to_string(),
            action: Action::Read as i32,
        })
        .await
        .map_err(|e| {
            tracing::error!("CheckPerm failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "permission check failed" })),
            )
        })?
        .into_inner();

    if !resp.allowed {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "insufficient permissions" })),
        ));
    }

    let limit = params.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    // Fetch one extra row to detect has_more without a second query.
    let fetch_limit = limit + 1;

    let rows_opt = if let Some(before) = params.before {
        state
            .db
            .query(
                "SELECT message_id, author_id, content, attachments, created_at, deleted_at \
                 FROM messages WHERE channel_id = ? AND message_id < ? LIMIT ?",
                (channel_id, before, fetch_limit),
            )
            .await
    } else {
        state
            .db
            .query(
                "SELECT message_id, author_id, content, attachments, created_at, deleted_at \
                 FROM messages WHERE channel_id = ? LIMIT ?",
                (channel_id, fetch_limit),
            )
            .await
    }
    .map_err(|e| {
        tracing::error!("Cassandra query failed: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "failed to load messages" })),
        )
    })?;

    let mut messages: Vec<MessageResponse> = Vec::new();
    if let Some(rows) = rows_opt.rows {
        for row in rows.into_typed::<MessageRow>() {
            let row = row.map_err(|e| {
                tracing::error!("Row decode failed: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "failed to decode messages" })),
                )
            })?;
            if row.deleted_at.is_some() {
                continue;
            }
            messages.push(MessageResponse {
                message_id: row.message_id,
                channel_id,
                author_id: row.author_id,
                content: row.content,
                attachments: row.attachments.unwrap_or_default(),
                created_at: cql_to_datetime(row.created_at),
            });
        }
    }

    let has_more = messages.len() as i32 > limit;
    if has_more {
        messages.truncate(limit as usize);
    }
    let next_cursor = if has_more { messages.last().map(|m| m.message_id) } else { None };

    Ok(Json(ListMessagesResponse {
        messages,
        next_cursor,
        has_more,
    }))
}

#[derive(scylla::FromRow)]
struct MessageRow {
    message_id: Uuid,
    author_id: Uuid,
    content: String,
    attachments: Option<Vec<String>>,
    created_at: CqlTimestamp,
    deleted_at: Option<CqlTimestamp>,
}

fn cql_to_datetime(ts: CqlTimestamp) -> DateTime<Utc> {
    Utc.timestamp_millis_opt(ts.0).single().unwrap_or_else(Utc::now)
}

pub async fn delete_message(
    State(state): State<Arc<AppState>>,
    Path((channel_id, message_id)): Path<(Uuid, Uuid)>,
    auth: AuthUser,
) -> Result<StatusCode, (StatusCode, Json<Value>)> {
    let row_opt = state
        .db
        .query(
            "SELECT author_id, deleted_at FROM messages \
             WHERE channel_id = ? AND message_id = ?",
            (channel_id, message_id),
        )
        .await
        .map_err(|e| {
            tracing::error!("Cassandra select failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "failed to load message" })),
            )
        })?
        .rows
        .and_then(|rows| rows.into_typed::<DeleteRow>().next());

    let row = match row_opt {
        Some(Ok(r)) => r,
        Some(Err(e)) => {
            tracing::error!("Row decode failed: {}", e);
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "failed to decode message" })),
            ));
        }
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "not found" })),
            ));
        }
    };

    if row.deleted_at.is_some() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "not found" })),
        ));
    }

    if row.author_id != auth.user_id {
        let server_id = resolve_server_id(&state, channel_id).await;
        let mut perm = state.perm.clone();
        let resp = perm
            .check_perm(CheckPermRequest {
                user_id: auth.user_id.to_string(),
                server_id: server_id.map(|s| s.to_string()).unwrap_or_default(),
                channel_id: channel_id.to_string(),
                action: Action::Manage as i32,
            })
            .await
            .map_err(|e| {
                tracing::error!("CheckPerm failed: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "permission check failed" })),
                )
            })?
            .into_inner();
        if !resp.allowed {
            return Err((
                StatusCode::FORBIDDEN,
                Json(json!({ "error": "insufficient permissions" })),
            ));
        }
    }

    state
        .db
        .query(
            "UPDATE messages SET deleted_at = ? \
             WHERE channel_id = ? AND message_id = ?",
            (
                CqlTimestamp(Utc::now().timestamp_millis()),
                channel_id,
                message_id,
            ),
        )
        .await
        .map_err(|e| {
            tracing::error!("Cassandra delete update failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "failed to delete message" })),
            )
        })?;

    Ok(StatusCode::NO_CONTENT)
}

#[derive(scylla::FromRow)]
struct DeleteRow {
    author_id: Uuid,
    deleted_at: Option<CqlTimestamp>,
}

async fn publish_message_created(
    producer: &FutureProducer,
    message_id: Uuid,
    channel_id: Uuid,
    server_id: Option<Uuid>,
    author_id: Uuid,
    content: &str,
    attachments: &[String],
    created_at: DateTime<Utc>,
) {
    let payload = json!({
        "message_id": message_id,
        "channel_id": channel_id,
        "server_id": server_id.map(|s| Value::String(s.to_string())).unwrap_or(Value::Null),
        "author_id": author_id,
        "content": content,
        "attachments": attachments,
        "created_at": created_at.to_rfc3339(),
    });
    let payload = payload.to_string();
    let key = channel_id.to_string();

    let record = FutureRecord::to("message-created").payload(&payload).key(&key);
    if let Err((e, _)) = producer.send(record, Duration::from_secs(1)).await {
        tracing::error!("Kafka publish failed for message-created: {}", e);
    }
}

#[derive(Deserialize)]
struct PresenceSession {
    connection_id: String,
}

#[derive(Deserialize)]
struct PresenceQueryResponse {
    sessions: Vec<PresenceSession>,
}

async fn fanout_new_message(state: Arc<AppState>, channel_id: Uuid, payload: Value) {
    let presence_url = format!(
        "{}/sessions?channel_id={}",
        state.presence_addr.trim_end_matches('/'),
        channel_id
    );
    let resp = match state.http.get(&presence_url).send().await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("presence query failed: {}", e);
            return;
        }
    };
    if !resp.status().is_success() {
        tracing::warn!("presence query non-2xx: {}", resp.status());
        return;
    }
    let body: PresenceQueryResponse = match resp.json().await {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!("presence body decode failed: {}", e);
            return;
        }
    };
    if body.sessions.is_empty() {
        return;
    }
    let session_ids: Vec<String> = body.sessions.into_iter().map(|s| s.connection_id).collect();
    let push_body = json!({
        "session_ids": session_ids,
        "event": { "type": "new_message", "payload": payload },
    });
    if let Err(e) = state
        .http
        .post(&state.gateway_push_url)
        .json(&push_body)
        .send()
        .await
    {
        tracing::warn!("gateway push failed: {}", e);
    }
}

async fn publish_mentions(
    producer: &FutureProducer,
    user_cache: &UserCache,
    message_id: Uuid,
    channel_id: Uuid,
    server_id: Option<Uuid>,
    content: &str,
    created_at: DateTime<Utc>,
) {
    let mut usernames: HashSet<String> = HashSet::new();
    for cap in MENTION_RE.captures_iter(content) {
        if let Some(m) = cap.get(1) {
            usernames.insert(m.as_str().to_string());
        }
    }
    if usernames.is_empty() {
        return;
    }

    let cache = user_cache.read().await;
    for username in usernames {
        let Some(user_id) = cache.get(&username).copied() else {
            // Unknown username — ignore (user not yet seen via user-registered topic).
            continue;
        };
        let mention_id = Uuid::now_v7();
        let payload = json!({
            "mention_id": mention_id,
            "message_id": message_id,
            "mentioned_user_id": user_id,
            "channel_id": channel_id,
            "server_id": server_id.map(|s| Value::String(s.to_string())).unwrap_or(Value::Null),
            "created_at": created_at.to_rfc3339(),
        })
        .to_string();
        let key = user_id.to_string();
        let record = FutureRecord::to("mention").payload(&payload).key(&key);
        if let Err((e, _)) = producer.send(record, Duration::from_secs(1)).await {
            tracing::error!("Kafka publish failed for mention: {}", e);
        }
    }
}
