package ports

import (
	"context"
	"github.com/aoagents/agent-orchestrator/backend/internal/domain"
)

type nativeClientReclaimKey struct{}
type nativeClientReclaim struct {
	session  domain.SessionID
	nativeID string
}

// WithNativeClientReclaim authorizes only the explicit native resume call chain.
// It is never accepted from HTTP. Durable external ownership stays in place
// until that resume publishes successfully, including across daemon crashes.
func WithNativeClientReclaim(ctx context.Context, id domain.SessionID, nativeID string) context.Context {
	return context.WithValue(ctx, nativeClientReclaimKey{}, nativeClientReclaim{id, nativeID})
}
func NativeClientReclaimAuthorized(ctx context.Context, id domain.SessionID, nativeID string) bool {
	proof, ok := ctx.Value(nativeClientReclaimKey{}).(nativeClientReclaim)
	return ok && proof.session == id && proof.nativeID == nativeID && nativeID != ""
}
