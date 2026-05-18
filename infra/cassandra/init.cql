-- Runs once via cassandra-init after Cassandra passes its healthcheck.
-- SimpleStrategy with RF=1 is appropriate for a single-node dev cluster.

CREATE KEYSPACE IF NOT EXISTS discord_chat
  WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};

USE discord_chat;

CREATE TABLE IF NOT EXISTS messages (
    channel_id uuid,
    message_id timeuuid,
    author_id uuid,
    content text,
    PRIMARY KEY (channel_id, message_id)
) WITH CLUSTERING ORDER BY (message_id DESC);
