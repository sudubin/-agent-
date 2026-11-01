package store

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/aoagents/agent-orchestrator/backend/internal/domain"
	"github.com/aoagents/agent-orchestrator/backend/internal/storage/sqlite/gen"
)

// NativeClientHandoff is an ownership fact, independent of the displayed status.
func (s *Store) NativeClientHandoff(ctx context.Context, id domain.SessionID) (string, error) {
	nativeID, err := s.qr.GetNativeClientHandoff(ctx, string(id))
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return nativeID, err
}

// SetNativeClientHandoff atomically fences intake and records the cold provider.
func (s *Store) SetNativeClientHandoff(ctx context.Context, id domain.SessionID, revision int64, nativeID string, at time.Time) (bool, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	applied := false
	err := s.inTx(ctx, "hand off native client", func(q *gen.Queries) error {
		n, err := q.SetSessionHibernated(ctx, gen.SetSessionHibernatedParams{ID: id, ExpectedRevision: revision, HibernatedAt: timePtrToNullTime(&at)})
		if err != nil || n == 0 {
			return err
		}
		if err := q.InsertNativeClientHandoff(ctx, gen.InsertNativeClientHandoffParams{SessionID: string(id), ProviderConversationID: nativeID, HandedOffAt: at.UTC().Format(time.RFC3339Nano)}); err != nil {
			return err
		}
		applied = true
		return nil
	})
	return applied, err
}

func (s *Store) ClearNativeClientHandoff(ctx context.Context, id domain.SessionID, nativeID string) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	_, err := s.qw.DeleteNativeClientHandoff(ctx, gen.DeleteNativeClientHandoffParams{SessionID: string(id), ProviderConversationID: nativeID})
	return err
}
