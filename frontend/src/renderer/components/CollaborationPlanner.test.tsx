import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CollaborationPlanner } from "./CollaborationPlanner";
import type { CollaborationPlan } from "../lib/collaboration-plan";

const mocks = vi.hoisted(() => ({ post: vi.fn(), ready: vi.fn(), navigate: vi.fn(), hasMain: true }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("../lib/api-client", () => ({ apiClient: { POST: mocks.post }, getApiBaseUrl: () => "http://127.0.0.1:3037", apiErrorMessage: (e: unknown, fallback: string) => e ? "服务错误" : fallback }));
vi.mock("../hooks/useAgentReadinessQuery", () => ({ ensureAgentReadiness: mocks.ready }));
vi.mock("../hooks/useWorkspaceQuery", () => ({ useWorkspaceQuery: () => ({ data: [{ id: "p", sessions: mocks.hasMain ? [{ id: "master", title: "主 agent", kind: "orchestrator", provider: "codex", activity: { state: "idle" } }] : [] }] }), workspaceQueryKeyForHost: () => ["workspaces"] }));

const plan: CollaborationPlan = { title: "演示网站", tasks: [
	{ id: "art", stage: "素材", title: "插图", instructions: "绘制插图", acceptance: "PNG 文件存在", agent: "codex", dependsOn: [] },
	{ id: "code", stage: "实现", title: "页面", instructions: "制作页面", acceptance: "页面能打开", agent: "deepseek-harness", dependsOn: ["art"] },
] };
const key = "ao:collaboration-draft:v2:p";
function seed(overrides = {}) {
	localStorage.setItem(key, JSON.stringify({ goal: "制作网站", main: "codex", roster: [{ agent: "codex", responsibility: "绘图" }, { agent: "deepseek-harness", responsibility: "编程" }], plan, sessionId: "master", filename: "plan-x.json", runId: "run-x", createMain: false, switchMain: false, state: "draft", ...overrides }));
}
function show() {
	return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CollaborationPlanner projectId="p" open onOpenChange={vi.fn()} /></QueryClientProvider>);
}
beforeEach(() => {
	localStorage.clear(); vi.clearAllMocks();
	mocks.hasMain = true;
	mocks.ready.mockResolvedValue({ agents: ["codex", "deepseek-harness"].map((id) => ({ id, effectiveReadiness: "ready" })) });
	mocks.post.mockResolvedValue({ data: { state: "accepted" } });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("stage-card collaboration", () => {
	it("opening a saved draft never dispatches work", () => {
		seed(); show();
		expect(screen.getByDisplayValue("插图")).toBeInTheDocument();
		expect(mocks.post).not.toHaveBeenCalled();
	});
	it("sends a planning-only message and automatically imports the generated file", async () => {
		seed({ plan: null, filename: "", runId: "" });
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify(plan) }));
		show(); fireEvent.click(screen.getByRole("button", { name: "生成任务框架" }));
		await screen.findByDisplayValue("插图");
		expect(mocks.post).toHaveBeenCalledTimes(1);
		const [path, request] = mocks.post.mock.calls[0];
		expect(path).toBe("/api/v1/sessions/{sessionId}/conversation/messages");
		expect(request.body.text).toContain("不得自动派单");
		expect(request.body.text).toContain("绘图");
	});
	it("respects the user's per-card assignment and freezes the approved cards", async () => {
		seed(); show();
		fireEvent.change(screen.getAllByLabelText("执行 agent")[0], { target: { value: "deepseek-harness" } });
		fireEvent.click(screen.getByRole("button", { name: "确认分工，开始协作" }));
		await screen.findByRole("button", { name: "已提交协作" });
		const request = mocks.post.mock.calls[0][1];
		expect(request.body.clientMessageId).toBe("collaboration-run-run-x");
		expect(request.body.text).toContain('"agent": "deepseek-harness"');
		expect(screen.getAllByLabelText("执行 agent")[0]).toBeDisabled();
	});
	it("blocks cyclic dependencies without calling the daemon", async () => {
		seed({ plan: { ...plan, tasks: [{ ...plan.tasks[0], dependsOn: ["code"] }, plan.tasks[1]] } });
		show(); fireEvent.click(screen.getByRole("button", { name: "确认分工，开始协作" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("循环");
		expect(mocks.post).not.toHaveBeenCalled();
	});
	it("retains incomplete edits when the planner is reopened", () => {
		seed({ plan: { ...plan, tasks: [{ ...plan.tasks[0], acceptance: "" }, plan.tasks[1]] } });
		show();
		expect(screen.getByDisplayValue("插图")).toBeInTheDocument();
		expect(screen.getAllByLabelText("验收条件")[0]).toHaveValue("");
	});
	it("can return from a stalled planning request without dispatching or losing the goal", () => {
		seed({ plan: null });
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
		show(); fireEvent.click(screen.getByRole("button", { name: "返回团队设置" }));
		expect(screen.getByLabelText("主 agent")).not.toBeDisabled();
		expect(screen.getByDisplayValue("制作网站")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "查看主 agent 会话" })).toBeInTheDocument();
		expect(mocks.post).not.toHaveBeenCalled();
	});
	it("retries an ambiguous send with the same message identity and unchanged assignments", async () => {
		seed(); mocks.post.mockRejectedValueOnce(new Error("连接中断")).mockResolvedValueOnce({ data: { state: "accepted" } });
		show(); fireEvent.click(screen.getByRole("button", { name: "确认分工，开始协作" }));
		await waitFor(() => expect(screen.getByRole("button", { name: "恢复同一次执行请求" })).not.toBeDisabled());
		fireEvent.click(screen.getByRole("button", { name: "恢复同一次执行请求" }));
		await screen.findByRole("button", { name: "已提交协作" });
		expect(mocks.post.mock.calls[0][1].body).toEqual(mocks.post.mock.calls[1][1].body);
	});
	it("reopens an uncertain send using the persisted exact message", async () => {
		seed({ state: "uncertain", executionText: "此前已经确认的完整执行指令", projectPath: "/previous/project" }); show();
		fireEvent.click(screen.getByRole("button", { name: "恢复同一次执行请求" }));
		await screen.findByRole("button", { name: "已提交协作" });
		expect(mocks.post.mock.calls[0][1].body).toEqual({ text: "此前已经确认的完整执行指令", clientMessageId: "collaboration-run-run-x" });
	});
	it("does not submit when a selected worker is not ready", async () => {
		seed(); mocks.ready.mockResolvedValue({ agents: [{ id: "codex", effectiveReadiness: "ready" }] });
		show(); fireEvent.click(screen.getByRole("button", { name: "确认分工，开始协作" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("未就绪");
		expect(mocks.post).not.toHaveBeenCalled();
	});
	it("switches an idle main through AO's native provider handoff before planning", async () => {
		seed({ main: "deepseek-harness", plan: null, filename: "", runId: "" });
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify(plan) }));
		show(); fireEvent.click(screen.getByRole("button", { name: "切换主 agent 并生成框架" }));
		await screen.findByDisplayValue("插图");
		expect(mocks.post.mock.calls[0][0]).toBe("/api/v1/sessions/{sessionId}/provider-switch");
		expect(mocks.post.mock.calls[0][1].body.targetHarness).toBe("deepseek-harness");
		expect(mocks.post.mock.calls[0][1].body.message.text).toContain("不得自动派单");
	});
	it("requires replanning when the main was switched elsewhere", async () => {
		seed({ main: "deepseek-harness" }); show();
		fireEvent.click(screen.getByRole("button", { name: "确认分工，开始协作" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("主 agent 已在其他位置切换");
		expect(mocks.post).not.toHaveBeenCalled();
	});
	it("recovers new-main creation with AO's single-main rule and no worker-only request ID", async () => {
		mocks.hasMain = false;
		seed({ plan: null, sessionId: "", runId: "retry-x", filename: "collaboration-plan-retry-x.json", createMain: true });
		mocks.post.mockResolvedValue({ data: { session: { id: "recovered-main", displayName: "主 agent · 任务规划 [retry-x]", harness: "codex" } } });
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify(plan) }));
		show(); fireEvent.click(screen.getByRole("button", { name: "恢复同一次规划请求" }));
		await screen.findByDisplayValue("插图");
		const [path, request] = mocks.post.mock.calls[0];
		expect(path).toBe("/api/v1/sessions");
		expect(request.body).not.toHaveProperty("clientRequestId");
		expect(request.body.displayName).toBe("主 agent · 任务规划 [retry-x]");
		expect(request.body.prompt).toContain("仅规划");
		expect(mocks.post).toHaveBeenCalledTimes(1);
	});
	it("does not dispatch into a different main created concurrently", async () => {
		mocks.hasMain = false;
		seed({ plan: null, sessionId: "", runId: "", filename: "" });
		mocks.post.mockResolvedValue({ data: { session: { id: "another-main", displayName: "其他工作", harness: "codex" } } });
		show(); fireEvent.click(screen.getByRole("button", { name: "生成任务框架" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("项目已出现其他主 agent");
		expect(mocks.post).toHaveBeenCalledTimes(1);
		expect(JSON.parse(localStorage.getItem(key)!).filename).toBe("");
	});
});
