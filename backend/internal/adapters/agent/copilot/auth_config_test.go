package copilot

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/aoagents/agent-orchestrator/backend/internal/ports"
)

func TestCopilotAuthReadsNativeCommentedAccountConfigWithoutRewriting(t *testing.T) {
	for _, test := range []struct {
		name, config string
		loggedIn     bool
	}{
		{"current native config", "// Copilot configuration\n// Credentials use the OS store\n" + `{"loggedInUsers":[{"host":"https://github.com","kind":"github","login":"octocat"}],"lastLoggedInUser":{"host":"https://github.com","login":"octocat"}}`, true},
		{"plain array", `{"loggedInUsers":[{"host":"https://example.ghe.com","login":"octocat"}]}`, true},
		{"legacy map", `{"loggedInUsers":{"github.com":{"login":"octocat"}}}`, true},
		{"empty list", "// Config\n" + `{"loggedInUsers":[]}`, false},
		{"incomplete descriptor", `{"loggedInUsers":[{"host":"https://github.com"}]}`, false},
		{"null descriptor", `{"loggedInUsers":[null]}`, false},
		{"last account alone is not a login", `{"lastLoggedInUser":{"host":"https://github.com","login":"octocat"}}`, false},
		{"comment is not a login", "// {\"loggedInUsers\":[{\"host\":\"github.com\",\"login\":\"octocat\"}]}\n{}", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			file := filepath.Join(t.TempDir(), "config.json")
			before := []byte(test.config)
			if err := os.WriteFile(file, before, 0o600); err != nil {
				t.Fatal(err)
			}
			status, found, err := copilotConfigAuthStatus(file)
			if err != nil || found != test.loggedIn {
				t.Fatalf("status=%s found=%v error=%v", status, found, err)
			}
			if test.loggedIn && status != ports.AgentAuthStatusAuthorized {
				t.Fatalf("status=%s", status)
			}
			after, err := os.ReadFile(file)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatal("authentication detection modified native configuration")
			}
		})
	}
}
