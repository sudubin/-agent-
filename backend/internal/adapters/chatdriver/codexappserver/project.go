package codexappserver

import (
	"context"
	"crypto/sha256"
	"fmt"
	"path/filepath"
)

type projectConnection interface {
	request(context.Context, string, any, any) error
}
type nativeProject struct {
	ID    string `json:"id"`
	Roots []struct {
		Path string `json:"path"`
	} `json:"roots"`
}

// Projects belong to the provider, not AO's SQLite database or the app's private
// sidebar preferences. One registered root reuses one real native project while
// each agent keeps its own independent worktree as cwd.
func ensureNativeProject(ctx context.Context, connection projectConnection, root string) (string, error) {
	if !filepath.IsAbs(root) {
		return "", fmt.Errorf("native project root must be absolute")
	}
	canonical, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", fmt.Errorf("resolve native project root: %w", err)
	}
	canonical = filepath.Clean(canonical)
	cursor := ""
	seen := map[string]bool{}
	for {
		var response struct {
			Data       []nativeProject `json:"data"`
			NextCursor string          `json:"nextCursor"`
		}
		params := map[string]any{"limit": 100}
		if cursor != "" {
			params["cursor"] = cursor
		}
		if err := connection.request(ctx, "project/list", params, &response); err != nil {
			return "", fmt.Errorf("read Codex native projects: %w", err)
		}
		for _, project := range response.Data {
			for _, r := range project.Roots {
				path := filepath.Clean(r.Path)
				if resolved, e := filepath.EvalSymlinks(path); e == nil {
					path = resolved
				}
				if path == canonical && project.ID != "" {
					return project.ID, nil
				}
			}
		}
		if response.NextCursor == "" {
			break
		}
		if seen[response.NextCursor] {
			return "", fmt.Errorf("native project list repeated its cursor")
		}
		seen[response.NextCursor] = true
		cursor = response.NextCursor
	}
	var response struct {
		Project nativeProject `json:"project"`
	}
	params := map[string]any{"name": filepath.Base(canonical), "roots": []map[string]string{{"path": canonical}}, "idempotencyKey": fmt.Sprintf("coordinator-%x", sha256.Sum256([]byte(canonical)))}
	if err := connection.request(ctx, "project/create", params, &response); err != nil {
		return "", fmt.Errorf("create Codex native project: %w", err)
	}
	if response.Project.ID == "" {
		return "", fmt.Errorf("Codex native project returned no identity")
	}
	return response.Project.ID, nil
}

func bindNativeProject(ctx context.Context, connection projectConnection, root, threadID string) error {
	id, err := ensureNativeProject(ctx, connection, root)
	if err != nil {
		return err
	}
	if err := connection.request(ctx, "thread/metadata/update", map[string]any{"threadId": threadID, "projectId": id}, nil); err != nil {
		return fmt.Errorf("associate Codex conversation with native project: %w", err)
	}
	return nil
}
