use rdkafka::consumer::{Consumer, StreamConsumer};
use rdkafka::message::Message;
use rdkafka::ClientConfig;
use serde::Deserialize;
use uuid::Uuid;

use crate::state::UserCache;

#[derive(Deserialize)]
struct UserRegisteredEvent {
    user_id: Uuid,
    username: String,
}

pub fn spawn_consumer(brokers: String, cache: UserCache) -> anyhow::Result<()> {
    let consumer: StreamConsumer = ClientConfig::new()
        .set("bootstrap.servers", &brokers)
        .set("group.id", "chat-svc-user-registry")
        .set("enable.auto.commit", "true")
        .set("auto.offset.reset", "earliest")
        .create()?;

    consumer.subscribe(&["user-registered"])?;

    tokio::spawn(async move {
        loop {
            match consumer.recv().await {
                Ok(msg) => {
                    let payload = match msg.payload() {
                        Some(p) => p,
                        None => continue,
                    };
                    match serde_json::from_slice::<UserRegisteredEvent>(payload) {
                        Ok(ev) => {
                            cache.write().await.insert(ev.username, ev.user_id);
                        }
                        Err(e) => {
                            tracing::warn!("malformed user-registered event: {}", e);
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!("kafka recv error: {}", e);
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                }
            }
        }
    });

    Ok(())
}
