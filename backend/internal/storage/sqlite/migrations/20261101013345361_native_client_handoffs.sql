-- +goose Up
CREATE TABLE native_client_handoffs (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    provider_conversation_id TEXT NOT NULL,
    handed_off_at TEXT NOT NULL
);

-- +goose Down
DROP TABLE native_client_handoffs;
