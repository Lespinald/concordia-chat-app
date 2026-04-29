use axum::{routing::get, Json, Router, http::StatusCode};
use scylla::{Session, SessionBuilder};
use serde_json::{json, Value};
use std::env;
use std::sync::Arc;
use std::net::SocketAddr;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

struct AppState {
    // TODO: db session will be used by message routes in T-27
    db: Session,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(tracing_subscriber::fmt::layer())
        .init();
    
    dotenvy::dotenv().ok();

    let cassandra_hosts_str = env::var("CASSANDRA_HOSTS").unwrap_or_else(|_| "127.0.0.1:9042".to_string());
    let keyspace = env::var("CASSANDRA_KEYSPACE").unwrap_or_else(|_| "discord_chat".to_string());
    let port: u16 = env::var("CHAT_PORT").unwrap_or_else(|_| "3000".to_string()).parse().unwrap_or(3000);

    let hosts: Vec<&str> = cassandra_hosts_str.split(',').collect();

    tracing::info!("Connecting to Cassandra at {:?}...", hosts);

    let session: Session = SessionBuilder::new()
        .known_nodes(&hosts)
        .build()
        .await?;
    
    session.use_keyspace(keyspace, false).await?;
    
    let shared_state = Arc::new(AppState {
        db: session,
    });

    let app = Router::new()
        .route("/health", get(health_check))
        .with_state(shared_state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    
    tracing::info!("Service started on http://{}", addr);
    axum::serve(listener, app).await?;

    Ok(())
}

async fn health_check() -> (StatusCode, Json<Value>) {
    (StatusCode::OK, Json(json!({"status": "ok"})))
}