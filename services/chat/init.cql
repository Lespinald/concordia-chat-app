CREATE TABLE IF NOT EXISTS messages (
    channel_id uuid,
    message_id timeuuid,
    author_id uuid,
    content text,
    deleted_at text, -- <-- Nueva columna para el Soft Delete
    PRIMARY KEY (channel_id, message_id)
) WITH CLUSTERING ORDER BY (message_id DESC);