use axum::{routing::get, Json, Router};
use serde_json::{json, Value};
use std::env;

#[tokio::main]
async fn main() {
    let port = env::var("CHAT_PORT").unwrap_or_else(|_| "8083".to_string());
    let addr = format!("0.0.0.0:{port}");

    let app = Router::new().route("/health", get(health));

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    println!("chat starting on {addr}");
    axum::serve(listener, app).await.unwrap();
}

async fn health() -> Json<Value> {
    Json(json!({"status": "ok"}))
}
