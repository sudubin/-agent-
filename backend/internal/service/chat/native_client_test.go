package chat_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/aoagents/agent-orchestrator/backend/internal/domain"
	"github.com/aoagents/agent-orchestrator/backend/internal/ports"
	chatsvc "github.com/aoagents/agent-orchestrator/backend/internal/service/chat"
)

const nativeClientUUID = "00000000-0000-4000-8000-000000000001"

func nativeClientHarness(t *testing.T, state domain.TurnState) (*harness, *hibernationConversation) {
	return hibernationHarnessWith(t, state, func(opts *chatsvc.Options) {
		driver := opts.Drivers.(fakeRegistry).driver.(fakeDriver)
		driver.conv.(*hibernationConversation).providerConversationID = nativeClientUUID
	})
}

func TestNativeClientHandoffPersistsAndFencesSendsViewsAndRestart(t *testing.T) {
	h, conv := nativeClientHarness(t, domain.TurnStateCompleted)
	ctx := context.Background()
	// A project main can transfer; ordinary idle hibernation deliberately cannot.
	rec, _, _ := h.st.GetSession(ctx, testSession)
	rec.Kind = domain.KindOrchestrator
	if err := h.st.UpdateSession(ctx, rec); err != nil {
		t.Fatal(err)
	}
	info, err := h.svc.HandoffNativeClient(ctx, testSession)
	if err != nil || !info.External || info.NativeID != nativeClientUUID || conv.calls.Load() != 1 {
		t.Fatalf("handoff=%+v %v", info, err)
	}
	h.svc.SetWakeCallback(func(context.Context, domain.SessionID) error {
		t.Error("external client was automatically woken")
		return nil
	})
	for _, origin := range []domain.MessageOrigin{domain.MessageOrigin(""), domain.MessageOriginAutomation} {
		if _, err := h.svc.Send(ctx, testSession, ports.ChatUserMessage{Text: "do not deliver", Origin: origin}); !errors.Is(err, chatsvc.ErrNativeClientOwned) {
			t.Fatalf("send=%v", err)
		}
	}
	if err := h.svc.SetChatView(ctx, testSession, "test-view", true); err != nil {
		t.Fatal(err)
	}
	// A fresh service cannot resume or replace the same native conversation.
	restarted := chatsvc.New(chatsvc.Options{Sessions: h.st})
	if _, err := restarted.Start(ctx, chatsvc.StartConfig{SessionID: testSession, Harness: domain.HarnessCodex, ProviderConversationID: nativeClientUUID}); !errors.Is(err, chatsvc.ErrNativeClientOwned) {
		t.Fatalf("restart=%v", err)
	}
	snapshot, readErr := h.st.LoadConversationSnapshot(ctx, h.ctrl.ConversationID())
	if readErr != nil {
		t.Fatal(readErr)
	}
	if _, err := h.st.AppendUserMessage(ctx, snapshot.Conversation.ID, testSession, "", domain.ConversationMessage{ID: "racing-message", Text: "race"}, "racing-turn", h.now()); !errors.Is(err, domain.ErrNativeClientOwned) {
		t.Fatalf("storage intake race=%v", err)
	}
	if again, err := h.svc.HandoffNativeClient(ctx, testSession); err != nil || !again.External || conv.calls.Load() != 1 {
		t.Fatalf("idempotent handoff=%+v %v", again, err)
	}
}

func TestNativeClientHandoffRefusesRunningTurnAndBackgroundWork(t *testing.T) {
	for _, test := range []struct {
		name       string
		state      domain.TurnState
		background bool
	}{
		{"running", domain.TurnStateRunning, false}, {"background", domain.TurnStateCompleted, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			h, conv := nativeClientHarness(t, test.state)
			conv.backgroundRunning = test.background
			if _, err := h.svc.HandoffNativeClient(context.Background(), testSession); !errors.Is(err, chatsvc.ErrNativeClientBusy) {
				t.Fatalf("handoff=%v", err)
			}
			marker, err := h.st.NativeClientHandoff(context.Background(), testSession)
			if err != nil || marker != "" || conv.calls.Load() != 0 {
				t.Fatalf("busy transfer changed ownership: %q %v", marker, err)
			}
		})
	}
}

func TestNativeClientFailedReturnKeepsExternalOwnership(t *testing.T) {
	h, _ := nativeClientHarness(t, domain.TurnStateCompleted)
	ctx := context.Background()
	if _, err := h.svc.HandoffNativeClient(ctx, testSession); err != nil {
		t.Fatal(err)
	}
	h.svc.SetWakeCallback(func(context.Context, domain.SessionID) error { return errors.New("desktop still owns session lock") })
	if _, err := h.svc.ReclaimNativeClient(ctx, testSession); err == nil || !strings.Contains(err.Error(), "会话锁") {
		t.Fatalf("expected actionable failed resume, got %v", err)
	}
	marker, err := h.st.NativeClientHandoff(ctx, testSession)
	if err != nil || marker != nativeClientUUID {
		t.Fatalf("lost external ownership=%q %v", marker, err)
	}
}

func TestNativeClientSuccessfulReturnKeepsFenceUntilSameIDResumed(t *testing.T) {
	var resumed *fakeConversation
	h, _ := hibernationHarnessWith(t, domain.TurnStateCompleted, func(opts *chatsvc.Options) {
		driver := opts.Drivers.(fakeRegistry).driver.(fakeDriver)
		driver.conv.(*hibernationConversation).providerConversationID = nativeClientUUID
		driver.resume = func(cfg ports.ChatResumeConfig) (ports.ChatConversation, error) {
			if cfg.ProviderConversationID != nativeClientUUID {
				t.Errorf("replaced native conversation: %s", cfg.ProviderConversationID)
			}
			resumed = newFakeConversation()
			resumed.providerConversationID = nativeClientUUID
			return resumed, nil
		}
		opts.Drivers = fakeRegistry{driver: driver}
	})
	ctx := context.Background()
	if _, err := h.svc.HandoffNativeClient(ctx, testSession); err != nil {
		t.Fatal(err)
	}
	h.svc.SetWakeCallback(func(ctx context.Context, id domain.SessionID) error {
		marker, err := h.st.NativeClientHandoff(ctx, id)
		if err != nil || marker != nativeClientUUID {
			t.Fatalf("fence disappeared before resume: %q %v", marker, err)
		}
		rec, _, err := h.st.GetSession(ctx, id)
		if err != nil {
			return err
		}
		if _, err := h.st.SetSessionHibernated(ctx, id, rec.Revision, nil); err != nil {
			return err
		}
		_, err = h.svc.Start(ctx, chatsvc.StartConfig{SessionID: id, ProjectID: testProject, Harness: domain.HarnessCodex, ProviderConversationID: nativeClientUUID, WorkspacePath: t.TempDir()})
		return err
	})
	info, err := h.svc.ReclaimNativeClient(ctx, testSession)
	if err != nil || info.External || info.NativeID != nativeClientUUID || resumed == nil || !h.svc.HasLiveChatController(testSession) {
		t.Fatalf("reclaim=%+v %v", info, err)
	}
}
