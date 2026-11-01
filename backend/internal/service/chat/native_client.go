package chat

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/aoagents/agent-orchestrator/backend/internal/domain"
	"github.com/aoagents/agent-orchestrator/backend/internal/ports"
	"github.com/google/uuid"
)

var ErrNativeClientOwned = domain.ErrNativeClientOwned
var ErrNativeClientBusy = errors.New("会话仍有任务、排队消息或审批，请等待处理完成后再接管")
var ErrNativeClientUnsupported = errors.New("此 agent 尚未验证桌面同会话接管")

type nativeClientStore interface {
	NativeClientHandoff(context.Context, domain.SessionID) (string, error)
	SetNativeClientHandoff(context.Context, domain.SessionID, int64, string, time.Time) (bool, error)
	ClearNativeClientHandoff(context.Context, domain.SessionID, string) error
}

type NativeClientInfo struct {
	Harness   domain.AgentHarness
	NativeID  string
	Title     string
	External  bool
	Supported bool
}

func (s *Service) nativeClientAvailable(ctx context.Context, id domain.SessionID) error {
	st, ok := s.sessions.(nativeClientStore)
	if !ok {
		return nil
	}
	nativeID, err := st.NativeClientHandoff(ctx, id)
	if err != nil {
		return err
	}
	if nativeID != "" && !ports.NativeClientReclaimAuthorized(ctx, id, nativeID) {
		return ErrNativeClientOwned
	}
	return nil
}

func (s *Service) NativeClient(ctx context.Context, id domain.SessionID) (NativeClientInfo, error) {
	rec, err := s.requireChatSession(ctx, id)
	if err != nil {
		return NativeClientInfo{}, err
	}
	info := NativeClientInfo{Harness: rec.Harness, NativeID: rec.Metadata.ProviderConversationID, Title: rec.DisplayName}
	_, validID := uuid.Parse(info.NativeID)
	info.Supported = validID == nil && (rec.Harness == domain.HarnessCodex || rec.Harness == domain.HarnessDeepSeek || rec.Harness == domain.HarnessCopilot) && !rec.IsTerminated
	if st, ok := s.sessions.(nativeClientStore); ok {
		nativeID, err := st.NativeClientHandoff(ctx, id)
		if err != nil {
			return info, err
		}
		info.External = nativeID != ""
		if info.External && s.HasLiveChatController(id) {
			info.Supported = false
		}
		if info.External && nativeID != info.NativeID {
			return info, fmt.Errorf("native client ownership no longer matches provider")
		}
	}
	return info, nil
}

// HandoffNativeClient uses the same quiescence, provider background-work and
// revision checks as hibernation, but persists ownership before stopping. No
// view, automatic relay, restart or queued send may wake an external owner.
func (s *Service) HandoffNativeClient(ctx context.Context, id domain.SessionID) (NativeClientInfo, error) {
	info, err := s.NativeClient(ctx, id)
	if err != nil {
		return info, err
	}
	if !info.Supported {
		return info, ErrNativeClientUnsupported
	}
	if info.External {
		return info, nil
	}
	// Name native history without changing the project's orchestrator label.
	// The task prefix is retained, so execution-card correlation stays intact.
	if controller, release, err := s.workingController(ctx, id); err == nil {
		if renamer, ok := controller.conv.(ports.ChatRenamer); ok {
			title := info.Title
			if title == "" {
				title = "协作台 · " + string(id)
			}
			if err := renamer.SetTitle(ctx, title); err != nil {
				release()
				return info, err
			}
		}
		release()
	}
	stopped, err := s.hibernateChat(ctx, id, hibernateOptions{nativeClient: true, ignoreViews: true})
	if err != nil {
		return info, err
	}
	if !stopped {
		return info, ErrNativeClientBusy
	}
	return s.NativeClient(ctx, id)
}

// ReclaimNativeClient is an explicit handback, never an automatic wake. The
// caller confirms the desktop writer has stopped; normal native resume imports
// the provider's new history rather than copying a transcript into a new chat.
func (s *Service) ReclaimNativeClient(ctx context.Context, id domain.SessionID) (NativeClientInfo, error) {
	gate := s.controllerGate(domain.SessionConversationOwner(id))
	if err := gate.lock(ctx); err != nil {
		return NativeClientInfo{}, err
	}
	info, err := s.NativeClient(ctx, id)
	if err != nil {
		gate.unlock()
		return info, err
	}
	if !info.External {
		gate.unlock()
		return info, nil
	}
	st, ok := s.sessions.(nativeClientStore)
	if !ok {
		gate.unlock()
		return info, ErrNativeClientUnsupported
	}
	if s.HasLiveChatController(id) {
		gate.unlock()
		return info, ErrNativeClientBusy
	}

	if rec, readErr := s.requireChatSession(ctx, id); readErr != nil {
		gate.unlock()
		return info, readErr
	} else if rec.HibernatedAt == nil {
		marker, ok := s.sessions.(hibernationStore)
		if !ok {
			gate.unlock()
			return info, ErrNativeClientUnsupported
		}
		at := s.now()
		applied, err := marker.SetSessionHibernated(ctx, id, rec.Revision, &at)
		if err != nil || !applied {
			gate.unlock()
			if err != nil {
				return info, err
			}
			return info, ErrNativeClientBusy
		}
	}
	gate.unlock()
	// Keep the durable fence throughout resume. A failed resume or crash cannot
	// create a window in which automated messages reach the desktop-owned chat.
	resumeCtx := ports.WithNativeClientReclaim(ctx, id, info.NativeID)
	if err := s.wakeHibernated(resumeCtx, id); err != nil {
		// Resume may consume the cold marker before the provider rejects a lock.
		// Retain the external fence and restore cold intent for boot reconciliation.
		repairCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		if lockErr := gate.lock(repairCtx); lockErr == nil {
			if !s.HasLiveChatController(id) {
				if rec, readErr := s.requireChatSession(repairCtx, id); readErr == nil && rec.HibernatedAt == nil {
					if marker, ok := s.sessions.(hibernationStore); ok {
						at := s.now()
						if _, repairErr := marker.SetSessionHibernated(repairCtx, id, rec.Revision, &at); repairErr != nil {
							err = errors.Join(err, repairErr)
						}
					}
				}
			}
			gate.unlock()
		}
		return info, nativeClientResumeError(err)
	}
	if err := gate.lock(ctx); err != nil {
		return info, err
	}
	defer gate.unlock()
	if err := st.ClearNativeClientHandoff(ctx, id, info.NativeID); err != nil {
		return info, err
	}

	return s.NativeClient(ctx, id)
}

func nativeClientResumeError(err error) error {
	text := strings.ToLower(err.Error())
	if strings.Contains(text, "active writer") || strings.Contains(text, "sessionalreadyowned") || strings.Contains(text, "session lock") {
		return fmt.Errorf("%w：客户端仍持有会话锁。请关闭该会话并退出对应客户端后重试；仅停止生成不会释放占用", ErrNativeClientOwned)
	}
	return err
}
