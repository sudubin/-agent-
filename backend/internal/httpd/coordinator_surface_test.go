package httpd

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCoordinatorSurfaceKeepsOnlyProductFeatures(t *testing.T) {
	handler := coordinatorSurface(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	for _, path := range []string{"/api/v1/automations", "/api/v1/browser/commands", "/api/v1/computer-use/call", "/api/v1/cloud/link", "/api/v1/remotes/hosts", "/api/v1/mobile/settings"} {
		r := httptest.NewRecorder()
		handler.ServeHTTP(r, httptest.NewRequest(http.MethodPost, path, nil))
		if r.Code != http.StatusNotFound {
			t.Errorf("%s: status=%d, want 404", path, r.Code)
		}
	}
	for _, path := range []string{"/healthz", "/api/v1/projects", "/api/v1/sessions/p-1/conversation", "/api/v1/reports", "/api/v1/agents/codex/auth", "/mux"} {
		r := httptest.NewRecorder()
		handler.ServeHTTP(r, httptest.NewRequest(http.MethodGet, path, nil))
		if r.Code != http.StatusNoContent {
			t.Errorf("%s: status=%d, want 204", path, r.Code)
		}
	}
}
