use std::collections::HashMap;
use std::sync::Arc;

use aws_sdk_s3::Client as S3Client;
use rdkafka::producer::FutureProducer;
use scylla::Session;
use tokio::sync::RwLock;
use tonic::transport::Channel;
use uuid::Uuid;

use crate::proto::perm_service_client::PermServiceClient;

pub type UserCache = Arc<RwLock<HashMap<String, Uuid>>>;
pub type ChannelServerCache = Arc<RwLock<HashMap<Uuid, Uuid>>>;

pub struct AppState {
    pub db: Session,
    pub kafka: FutureProducer,
    pub perm: PermServiceClient<Channel>,
    pub s3: S3Client,
    pub s3_bucket: String,
    pub s3_public_endpoint: String,
    pub user_cache: UserCache,
    pub channel_server_cache: ChannelServerCache,
    pub servers_http_addr: String,
    pub presence_addr: String,
    pub gateway_push_url: String,
    pub http: reqwest::Client,
}
