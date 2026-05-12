use axum::{
    async_trait,
    extract::FromRequestParts,
    http::{header, request::Parts, StatusCode},
    Json,
};
use serde_json::json;
use uuid::Uuid;

pub struct AuthUser {
    pub user_id: Uuid,
}

pub struct AuthError(pub StatusCode, pub &'static str);

impl axum::response::IntoResponse for AuthError {
    fn into_response(self) -> axum::response::Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

#[async_trait]
impl<S> FromRequestParts<S> for AuthUser
where
    S: Send + Sync,
{
    type Rejection = AuthError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let header_value = parts
            .headers
            .get(header::AUTHORIZATION)
            .ok_or(AuthError(StatusCode::UNAUTHORIZED, "unauthorized"))?
            .to_str()
            .map_err(|_| AuthError(StatusCode::UNAUTHORIZED, "unauthorized"))?;

        let token = header_value
            .strip_prefix("Bearer ")
            .ok_or(AuthError(StatusCode::UNAUTHORIZED, "unauthorized"))?;

        let claims = authmw::validate_jwt(token)
            .map_err(|_| AuthError(StatusCode::UNAUTHORIZED, "unauthorized"))?;

        let user_id = Uuid::parse_str(&claims.sub)
            .map_err(|_| AuthError(StatusCode::UNAUTHORIZED, "unauthorized"))?;

        Ok(AuthUser { user_id })
    }
}
