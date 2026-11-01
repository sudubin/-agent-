package controllers

import (
	"context"
	"net/http"

	"github.com/aoagents/agent-orchestrator/backend/internal/domain"
	"github.com/aoagents/agent-orchestrator/backend/internal/httpd/apispec"
	"github.com/aoagents/agent-orchestrator/backend/internal/httpd/envelope"
	chatsvc "github.com/aoagents/agent-orchestrator/backend/internal/service/chat"
	"github.com/go-chi/chi/v5"
)

type nativeClientService interface {
	NativeClient(context.Context, domain.SessionID) (chatsvc.NativeClientInfo, error)
	HandoffNativeClient(context.Context, domain.SessionID) (chatsvc.NativeClientInfo, error)
	ReclaimNativeClient(context.Context, domain.SessionID) (chatsvc.NativeClientInfo, error)
}

func (c *ConversationsController) nativeClient(w http.ResponseWriter, r *http.Request) {
	svc, ok := c.Svc.(nativeClientService)
	if !ok {
		apispec.NotImplemented(w, r, r.Method, "/api/v1/sessions/{sessionId}/conversation/native-client")
		return
	}
	id := domain.SessionID(chi.URLParam(r, "sessionId"))
	var info chatsvc.NativeClientInfo
	var err error
	if r.Method == http.MethodPost {
		var req NativeClientRequest
		if !decodeConversationBody(w, r, &req) {
			return
		}
		switch req.Action {
		case "handoff":
			info, err = svc.HandoffNativeClient(r.Context(), id)
		case "reclaim":
			if !req.DesktopStopped {
				envelope.WriteAPIError(w, r, http.StatusBadRequest, "validation", "DESKTOP_STOP_REQUIRED", "请先停止桌面客户端中的会话，再确认收回", nil)
				return
			}
			info, err = svc.ReclaimNativeClient(r.Context(), id)
		default:
			envelope.WriteAPIError(w, r, http.StatusBadRequest, "validation", "NATIVE_CLIENT_ACTION_INVALID", "未知客户端操作", nil)
			return
		}
	} else {
		info, err = svc.NativeClient(r.Context(), id)
	}
	if err != nil {
		writeConversationError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusOK, NativeClientResponse{SessionID: id, Harness: info.Harness, NativeID: info.NativeID, Title: info.Title, External: info.External, Supported: info.Supported})
}
