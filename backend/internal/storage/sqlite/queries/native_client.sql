-- name: GetNativeClientHandoff :one
SELECT provider_conversation_id FROM native_client_handoffs WHERE session_id = ?;

-- name: InsertNativeClientHandoff :exec
INSERT INTO native_client_handoffs (session_id, provider_conversation_id, handed_off_at) VALUES (?, ?, ?);

-- name: DeleteNativeClientHandoff :execrows
DELETE FROM native_client_handoffs WHERE session_id = ? AND provider_conversation_id = ?;
