mod auth;
mod handlers;
mod proto;
mod state;
mod user_registry;

use axum::{extract::DefaultBodyLimit, routing::get, Json, Router, http::StatusCode};
use aws_config::{BehaviorVersion, Region};
use aws_credential_types::Credentials;
use aws_sdk_s3::config::Builder as S3ConfigBuilder;
use rdkafka::{config::ClientConfig, producer::FutureProducer};
use scylla::{Session, SessionBuilder};
use serde_json::{json, Value};
use std::env;
use std::net::SocketAddr;
use std::sync::Arc;
use tonic::transport::Channel;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use crate::handlers::attachments::upload_attachment;
use crate::handlers::messages::{create_message, delete_message, list_messages};
use crate::proto::perm_service_client::PermServiceClient;
use crate::state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(tracing_subscriber::fmt::layer())
        .init();

    dotenvy::dotenv().ok();

    let cassandra_hosts = resolve_cassandra_hosts();
    let keyspace = env::var("CASSANDRA_KEYSPACE").unwrap_or_else(|_| "discord_chat".to_string());
    let port: u16 = env::var("CHAT_PORT").unwrap_or_else(|_| "8083".to_string()).parse().unwrap_or(8083);

    let kafka_brokers = env::var("KAFKA_BROKERS").unwrap_or_else(|_| "kafka:9093".to_string());
    let servers_grpc_addr = ensure_http_scheme(
        env::var("SERVERS_GRPC_ADDR").unwrap_or_else(|_| "http://servers:50051".to_string()),
    );

    tracing::info!("Connecting to Cassandra at {:?}...", cassandra_hosts);
    let session: Session = SessionBuilder::new()
        .known_nodes(&cassandra_hosts)
        .build()
        .await?;
    session.use_keyspace(&keyspace, false).await?;
    ensure_messages_table(&session).await?;

    tracing::info!("Connecting to Kafka brokers: {}", kafka_brokers);
    let kafka: FutureProducer = ClientConfig::new()
        .set("bootstrap.servers", &kafka_brokers)
        .set("message.timeout.ms", "5000")
        .create()?;

    tracing::info!("Connecting gRPC client to Servers at {}", servers_grpc_addr);
    let perm_channel = Channel::from_shared(servers_grpc_addr.clone())?.connect_lazy();
    let perm = PermServiceClient::new(perm_channel);

    let s3_endpoint = env::var("MINIO_ENDPOINT_INTERNAL").unwrap_or_else(|_| "http://minio:9000".to_string());
    let s3_public_endpoint = env::var("MINIO_ENDPOINT_PUBLIC").unwrap_or_else(|_| "http://localhost:9000".to_string());
    let s3_bucket = env::var("MINIO_BUCKET").unwrap_or_else(|_| "attachments".to_string());
    let s3_access = env::var("MINIO_ROOT_USER").unwrap_or_else(|_| "minioadmin".to_string());
    let s3_secret = env::var("MINIO_ROOT_PASSWORD").unwrap_or_else(|_| "minioadmin".to_string());
    let s3_creds = Credentials::new(&s3_access, &s3_secret, None, None, "static");
    let s3_conf = S3ConfigBuilder::new()
        .behavior_version(BehaviorVersion::latest())
        .endpoint_url(&s3_endpoint)
        .region(Region::new("us-east-1"))
        .credentials_provider(s3_creds)
        .force_path_style(true)
        .build();
    let s3 = aws_sdk_s3::Client::from_conf(s3_conf);

    let presence_addr = env::var("PRESENCE_HTTP_ADDR").unwrap_or_else(|_| "http://presence:8086".to_string());
    let gateway_push_url = env::var("GATEWAY_INTERNAL_PUSH_URL")
        .unwrap_or_else(|_| "http://gateway:8080/internal/push".to_string());
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()?;

    let user_cache: state::UserCache = Arc::new(tokio::sync::RwLock::new(Default::default()));
    if let Err(e) = user_registry::spawn_consumer(kafka_brokers.clone(), user_cache.clone()) {
        tracing::warn!("user-registered consumer failed to start: {}", e);
    }

    let channel_server_cache: state::ChannelServerCache =
        Arc::new(tokio::sync::RwLock::new(Default::default()));
    let servers_http_addr =
        env::var("SERVERS_HTTP_ADDR").unwrap_or_else(|_| "http://servers:8082".to_string());

    let shared_state = Arc::new(AppState {
        db: session,
        kafka,
        perm,
        s3,
        s3_bucket,
        s3_public_endpoint,
        user_cache,
        channel_server_cache,
        servers_http_addr,
        presence_addr,
        gateway_push_url,
        http,
    });

    let app = Router::new()
        .route("/health", get(health_check))
        .route(
            "/channels/:channel_id/messages",
            get(list_messages).post(create_message),
        )
        .route(
            "/channels/:channel_id/messages/:message_id",
            axum::routing::delete(delete_message),
        )
        .route(
            "/channels/:channel_id/attachments",
            axum::routing::post(upload_attachment).layer(DefaultBodyLimit::max(26 * 1024 * 1024)),
        )
        .with_state(shared_state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;

    tracing::info!("Service started on http://{}", addr);
    axum::serve(listener, app).await?;

    Ok(())
}

fn resolve_cassandra_hosts() -> Vec<String> {
    if let Ok(multi) = env::var("CASSANDRA_HOSTS") {
        return multi.split(',').map(|s| s.trim().to_string()).collect();
    }
    let host = env::var("CASSANDRA_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = env::var("CASSANDRA_PORT").unwrap_or_else(|_| "9042".to_string());
    vec![format!("{host}:{port}")]
}

fn ensure_http_scheme(addr: String) -> String {
    if addr.starts_with("http://") || addr.starts_with("https://") {
        addr
    } else {
        format!("http://{addr}")
    }
}

async fn ensure_messages_table(session: &Session) -> anyhow::Result<()> {
    session
        .query(
            "CREATE TABLE IF NOT EXISTS messages (
                channel_id  uuid,
                message_id  uuid,
                author_id   uuid,
                content     text,
                attachments list<text>,
                created_at  timestamp,
                deleted_at  timestamp,
                PRIMARY KEY (channel_id, message_id)
            ) WITH CLUSTERING ORDER BY (message_id DESC)",
            (),
        )
        .await?;
    Ok(())
}

async fn health_check() -> (StatusCode, Json<Value>) {
    (StatusCode::OK, Json(json!({"status": "ok"})))
}
