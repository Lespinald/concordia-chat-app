use std::sync::Arc;

use axum::{
    extract::{Multipart, Path, State},
    http::StatusCode,
    Json,
};
use aws_sdk_s3::primitives::ByteStream;
use serde::Serialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{auth::AuthUser, state::AppState};

const MAX_FILE_BYTES: usize = 25 * 1024 * 1024;

#[derive(Serialize)]
pub struct AttachmentResponse {
    pub attachment_id: Uuid,
    pub url: String,
    pub filename: String,
    pub size_bytes: usize,
}

pub async fn upload_attachment(
    State(state): State<Arc<AppState>>,
    Path(channel_id): Path<Uuid>,
    _auth: AuthUser,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<AttachmentResponse>), (StatusCode, Json<Value>)> {
    let mut field = loop {
        match multipart.next_field().await {
            Ok(Some(f)) => {
                if f.name() == Some("file") {
                    break f;
                }
            }
            Ok(None) => {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "missing file field" })),
                ));
            }
            Err(e) => {
                tracing::error!("multipart error: {}", e);
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "invalid multipart body" })),
                ));
            }
        }
    };

    let filename = field
        .file_name()
        .map(|s| s.to_string())
        .ok_or((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "missing filename" })),
        ))?;
    let content_type = field
        .content_type()
        .map(|s| s.to_string())
        .unwrap_or_else(|| "application/octet-stream".to_string());

    if !is_allowed_mime(&content_type) {
        return Err((
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            Json(json!({ "error": "unsupported media type" })),
        ));
    }

    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = field.chunk().await.map_err(|e| {
        tracing::error!("multipart chunk error: {}", e);
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "failed to read upload" })),
        )
    })? {
        if buf.len() + chunk.len() > MAX_FILE_BYTES {
            return Err((
                StatusCode::PAYLOAD_TOO_LARGE,
                Json(json!({ "error": "file exceeds 25 MB limit" })),
            ));
        }
        buf.extend_from_slice(&chunk);
    }

    let attachment_id = Uuid::now_v7();
    let key = format!("{}/{}/{}", channel_id, attachment_id, filename);
    let size_bytes = buf.len();

    state
        .s3
        .put_object()
        .bucket(&state.s3_bucket)
        .key(&key)
        .content_type(&content_type)
        .body(ByteStream::from(buf))
        .send()
        .await
        .map_err(|e| {
            tracing::error!("MinIO upload failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "failed to upload file" })),
            )
        })?;

    let url = format!(
        "{}/{}/{}",
        state.s3_public_endpoint.trim_end_matches('/'),
        state.s3_bucket,
        key
    );

    Ok((
        StatusCode::CREATED,
        Json(AttachmentResponse {
            attachment_id,
            url,
            filename,
            size_bytes,
        }),
    ))
}

fn is_allowed_mime(ct: &str) -> bool {
    let lower = ct.to_ascii_lowercase();
    let mime = lower.split(';').next().unwrap_or("").trim();
    if let Some(rest) = mime.strip_prefix("image/") {
        return !rest.is_empty();
    }
    matches!(mime, "video/mp4" | "application/pdf")
}
