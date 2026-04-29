CREATE KEYSPACE IF NOT EXISTS discord_chat 
WITH REPLICATION = { 'class' : 'SimpleStrategy', 'replication_factor' : 1 };

USE discord_chat;

CREATE TABLE IF NOT EXISTS messages (
    channel_id uuid,
    message_id timeuuid,
    author_id uuid,
    content text,
    PRIMARY KEY (channel_id, message_id)
) WITH CLUSTERING ORDER BY (message_id DESC);


