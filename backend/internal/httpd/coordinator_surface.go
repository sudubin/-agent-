package httpd

import (
	"net/http"
	"strings"
)

// The coordinator product keeps local collaboration, not the original desktop's
// browser automation, cloud linking, remote control, mobile or cron surfaces.
func coordinatorSurface(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for _, prefix := range []string{"/api/v1/automations", "/api/v1/awake", "/api/v1/browser", "/api/v1/computer-use", "/api/v1/remotes", "/api/v1/mobile", "/api/v1/cloud", "/api/v1/remote-access"} {
			if r.URL.Path == prefix || strings.HasPrefix(r.URL.Path, prefix+"/") {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusNotFound)
				_, _ = w.Write([]byte(`{"error":"not_found","code":"FEATURE_NOT_IN_PRODUCT","message":"此功能不属于协作台。"}`))
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
