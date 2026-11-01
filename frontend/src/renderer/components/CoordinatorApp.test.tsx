import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoordinatorApp } from "./CoordinatorApp";
import type { WorkspaceSummary } from "../types/workspace";

const mocks = vi.hoisted(() => ({ workspaces: [] as WorkspaceSummary[], get: vi.fn(), post: vi.fn(), ready: vi.fn(), choose: vi.fn(), openFolder: vi.fn() }));
vi.mock("../hooks/useDaemonStatus", () => ({ useDaemonStatus: () => ({ state: "ready", port: 3310 }) }));
vi.mock("../hooks/useWorkspaceQuery", () => ({ useWorkspaceQuery: () => ({ data: mocks.workspaces }), workspaceQueryKeyForHost: () => ["workspaces"] }));
vi.mock("../hooks/useAgentReadinessQuery", () => ({ ensureAgentReadiness: mocks.ready, cacheAgentReadiness: vi.fn(), useAgentReadinessQuery: () => ({ data: { agents: ["codex", "deepseek-harness"].map((id) => ({ id, effectiveReadiness: "ready" })) } }) }));
vi.mock("../lib/api-client", () => ({ apiClient: { GET: mocks.get, POST: mocks.post }, getApiBaseUrl: () => "http://127.0.0.1:3310", apiErrorCode: (e: { code?: string } | null) => e?.code, apiErrorMessage: (_e: unknown, fallback: string) => fallback }));
vi.mock("../lib/bridge", () => ({ aoBridge: { app: { chooseDirectory: mocks.choose, getRepositoryBranch: async () => "main", onQuitConfirmRequest: () => () => undefined, resolveQuitConfirm: vi.fn(), openCollaborationFolder: mocks.openFolder } } }));

const task = { id: "work", stage: "实现", title: "制作页面", agent: "deepseek-harness", instructions: "创建 HTML 页面", acceptance: "页面可打开", dependsOn: [] };
const plan = { title: "示例计划", tasks: [task] };
const master = { id: "master", title: "主 agent", kind: "orchestrator", provider: "codex", status: "idle", activity: { state: "idle" } };
const worker = { id: "worker", title: "[run-x:work] 制作页面", kind: "worker", provider: "deepseek-harness", status: "idle", activity: { state: "idle" } };
function seed(state = "draft") {
	localStorage.setItem("ao:collaboration-draft:v2:p", JSON.stringify({ goal: "制作页面", main: "codex", roster: [{ agent: "codex", responsibility: "素材" }, { agent: "deepseek-harness", responsibility: "编码" }], plan, sessionId: "master", filename: "plan.json", runId: "run-x", createMain: false, switchMain: false, state }));
}
function show() {
	return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CoordinatorApp openSession={vi.fn()} openSettings={vi.fn()} /></QueryClientProvider>);
}
beforeEach(() => {
	vi.clearAllMocks(); localStorage.clear();
	mocks.workspaces = [{ id: "p", name: "示例项目", kind: "single_repo", path: "/sample/project", sessions: [master] }] as WorkspaceSummary[];
	mocks.ready.mockResolvedValue({ agents: ["codex", "deepseek-harness"].map((id) => ({ id, effectiveReadiness: "ready" })) });
	mocks.post.mockResolvedValue({ data: { state: "accepted" } });
	mocks.get.mockResolvedValue({ data: { reports: [] } });
	vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
});
afterEach(() => vi.unstubAllGlobals());

describe("simplified coordinator", () => {
	it("offers a single project-picker entry before a project exists", () => {
		mocks.workspaces = []; show();
		expect(screen.getByRole("button", { name: /选择项目文件夹/ })).toBeInTheDocument();
		expect(mocks.post).not.toHaveBeenCalled();
	});
	it("requires the visible prepare action before initializing a plain folder", async () => {
		mocks.workspaces = []; mocks.choose.mockResolvedValue("/sample/new-project");
		mocks.post.mockResolvedValueOnce({ error: { code: "NOT_A_GIT_REPO" } }).mockResolvedValueOnce({ data: { path: "/sample/new-project" } }).mockResolvedValueOnce({ data: { project: { id: "new-project" } } });
		show(); fireEvent.click(screen.getByRole("button", { name: /选择项目文件夹/ }));
		await screen.findByRole("button", { name: "启用并打开项目" });
		expect(mocks.post).toHaveBeenCalledTimes(1);
		fireEvent.click(screen.getByRole("button", { name: "启用并打开项目" }));
		await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(3));
		expect(mocks.post.mock.calls.map(([route]) => route)).toEqual(["/api/v1/projects", "/api/v1/projects/initialize", "/api/v1/projects"]);
	});
	it("sends the chosen card agent only after Start is clicked", async () => {
		seed(); show();
		fireEvent.change(screen.getByLabelText("执行 agent"), { target: { value: "codex" } });
		expect(mocks.post).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: /开始协作/ }));
		await screen.findByText("团队正在协作");
		expect(mocks.post.mock.calls[0][1].body.text).toContain('"agent": "codex"');
		expect(mocks.post.mock.calls[0][1].body.clientMessageId).toBe("collaboration-run-run-x");
	});
	it("does not label an idle worker as verified without its done report", async () => {
		seed("submitted"); mocks.workspaces[0].sessions.push(worker as WorkspaceSummary["sessions"][number]);
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ runId: "run-x", summary: "已完成", tasks: [{ id: "work", sessionId: "worker", status: "completed" }] }) }));
		show(); await waitFor(() => expect(mocks.get).toHaveBeenCalled());
		expect(screen.queryByText("主 agent 已完成验收")).not.toBeInTheDocument();
	});
	it("requires the actual harness, report and main verification to display completion", async () => {
		seed("submitted"); mocks.workspaces[0].sessions.push(worker as WorkspaceSummary["sessions"][number]);
		mocks.get.mockResolvedValue({ data: { reports: [{ sessionId: "worker", state: "done", createdAt: "2026-10-31T10:00:00Z" }] } });
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ runId: "run-x", summary: "页面已归档", tasks: [{ id: "work", sessionId: "worker", status: "completed" }] }) }));
		show(); await screen.findByText("主 agent 已完成验收");
		fireEvent.click(screen.getByRole("button", { name: /查看交付文件/ }));
		expect(mocks.openFolder).toHaveBeenCalledWith({ projectId: "p", runId: "run-x" });
	});
});
