package codexappserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/aoagents/agent-orchestrator/backend/internal/ports"
	"path/filepath"
	"testing"
)

type projectStub struct {
	calls  []string
	handle func(string, any) (any, error)
}

func TestDriverNativeProjectStartAndResume(t *testing.T) {
	for _, resume := range []bool{false, true} {
		t.Run(fmt.Sprint(resume), func(t *testing.T) {
			driver, server := newTestDriver(t)
			root := t.TempDir()
			cwd := filepath.Join(root, "isolated-worktree")
			projects, _ := json.Marshal(map[string]any{"data": []any{map[string]any{"id": "shared-native-project", "roots": []map[string]string{{"path": root}}}}})
			server.respondTo("project/list", string(projects))
			server.respondTo("thread/metadata/update", `{}`)
			if resume {
				conv, err := driver.Resume(context.Background(), ports.ChatResumeConfig{WorkspacePath: cwd, NativeProjectRoot: root, ProviderConversationID: "thread-1"})
				if err != nil {
					t.Fatal(err)
				}
				defer conv.Close()
				frame := server.awaitFrame(func(f frame) bool { return f.Method == "thread/metadata/update" })
				var params map[string]any
				_ = json.Unmarshal(frame.Params, &params)
				if params["threadId"] != "thread-1" || params["projectId"] != "shared-native-project" {
					t.Fatalf("wrong native association: %v", params)
				}
			} else {
				conv, err := driver.Start(context.Background(), ports.ChatStartConfig{WorkspacePath: cwd, NativeProjectRoot: root})
				if err != nil {
					t.Fatal(err)
				}
				defer conv.Close()
				frame := server.awaitFrame(func(f frame) bool { return f.Method == "thread/start" })
				var params map[string]any
				_ = json.Unmarshal(frame.Params, &params)
				if params["cwd"] != cwd || params["projectId"] != "shared-native-project" {
					t.Fatalf("worktree and native project must be independent: %v", params)
				}
			}
		})
	}
}

func (s *projectStub) request(_ context.Context, method string, params, out any) error {
	s.calls = append(s.calls, method)
	response, err := s.handle(method, params)
	if err != nil {
		return err
	}
	if out == nil {
		return nil
	}
	b, _ := json.Marshal(response)
	return json.Unmarshal(b, out)
}
func TestNativeProjectReusesExistingRootAcrossPages(t *testing.T) {
	root, _ := filepath.EvalSymlinks(t.TempDir())
	stub := &projectStub{}
	stub.handle = func(method string, params any) (any, error) {
		if method != "project/list" {
			t.Fatalf("must reuse, got %s", method)
		}
		p := params.(map[string]any)
		if p["cursor"] == nil {
			return map[string]any{"data": []any{}, "nextCursor": "page2"}, nil
		}
		return map[string]any{"data": []any{map[string]any{"id": "existing", "roots": []any{map[string]string{"path": root}}}}}, nil
	}
	id, err := ensureNativeProject(context.Background(), stub, root)
	if err != nil || id != "existing" || len(stub.calls) != 2 {
		t.Fatalf("id=%s calls=%v err=%v", id, stub.calls, err)
	}
}
func TestNativeProjectCreationUsesStableRootIdentityAndAssociatesThread(t *testing.T) {
	root, _ := filepath.EvalSymlinks(t.TempDir())
	var keys []string
	stub := &projectStub{}
	stub.handle = func(method string, params any) (any, error) {
		switch method {
		case "project/list":
			return map[string]any{"data": []any{}}, nil
		case "project/create":
			p := params.(map[string]any)
			keys = append(keys, p["idempotencyKey"].(string))
			if p["name"] != filepath.Base(root) || p["roots"].([]map[string]string)[0]["path"] != root {
				t.Fatal("wrong registered root")
			}
			return map[string]any{"project": map[string]any{"id": "created"}}, nil
		case "thread/metadata/update":
			p := params.(map[string]any)
			if p["threadId"] != "thread" || p["projectId"] != "created" {
				t.Fatal("wrong association")
			}
			return nil, nil
		}
		t.Fatalf("unexpected %s", method)
		return nil, nil
	}
	for i := 0; i < 2; i++ {
		if err := bindNativeProject(context.Background(), stub, root, "thread"); err != nil {
			t.Fatal(err)
		}
	}
	if len(keys) != 2 || keys[0] != keys[1] || keys[0] == "" {
		t.Fatal("creation must be idempotent across agents")
	}
}
func TestNativeProjectDoesNotCreateWhenListingFails(t *testing.T) {
	stub := &projectStub{handle: func(string, any) (any, error) { return nil, errors.New("unsupported native projects") }}
	if _, err := ensureNativeProject(context.Background(), stub, t.TempDir()); err == nil || len(stub.calls) != 1 || stub.calls[0] != "project/list" {
		t.Fatalf("must not silently create or claim success: %v %v", stub.calls, err)
	}
}
