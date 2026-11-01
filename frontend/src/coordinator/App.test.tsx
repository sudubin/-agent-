import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoordinatorApp } from "./App";
import type { WorkspaceSummary } from "./data";

const mocks = vi.hoisted(() => ({ workspaces: [] as WorkspaceSummary[], get: vi.fn(), post: vi.fn(), ready: vi.fn(), choose: vi.fn(), openFolder: vi.fn() }));
vi.mock("./data", () => ({ useDaemonStatus: () => ({ state: "ready", port: 3310 }), useWorkspaceQuery: () => ({ data: mocks.workspaces }), workspaceQueryKeyForHost: () => ["workspaces"], ensureAgentReadiness: mocks.ready, cacheAgentReadiness: vi.fn(), useAgentReadinessQuery: () => ({ data: { agents: ["codex", "deepseek-harness"].map((id) => ({ id, effectiveReadiness: "ready" })) } }) }));
vi.mock("./api", () => ({ apiClient: { GET: mocks.get, POST: mocks.post }, getApiBaseUrl: () => "http://127.0.0.1:3310", apiErrorCode: (e: { code?: string } | null) => e?.code, apiErrorMessage: (_e: unknown, fallback: string) => fallback }));
vi.mock("./bridge", () => ({ aoBridge: { app: { chooseDirectory: mocks.choose, getRepositoryBranch: async () => "main", onQuitConfirmRequest: () => () => undefined, resolveQuitConfirm: vi.fn(), openCollaborationFolder: mocks.openFolder } } }));

const task = { id: "work", stage: "实现", title: "制作页面", agent: "deepseek-harness", instructions: "创建 HTML 页面", acceptance: "页面可打开", dependsOn: [] };
const plan = { title: "示例计划", tasks: [task] };
const master = { id: "master", title: "主 agent", kind: "orchestrator", provider: "codex", status: "idle", activity: { state: "idle" } };
const worker = { id: "worker", title: "[run-x:work] 制作页面", kind: "worker", provider: "deepseek-harness", status: "idle", activity: { state: "idle" } };
function seed(state = "draft") {
	localStorage.setItem("ao:collaboration-draft:v2:p", JSON.stringify({ goal: "制作页面", main: "codex", roster: [{ agent: "codex", responsibility: "素材" }, { agent: "deepseek-harness", responsibility: "编码" }], plan, sessionId: "master", filename: "plan.json", runId: "run-x", createMain: false, switchMain: false, state }));
}
function getResponse(route: string, reports: unknown[] = []) {
 if (route.endsWith("/conversation/native-client")) return {data:{sessionId:"master",external:false,supported:true,harness:"codex",nativeId:"native-master"}};
 if (route.endsWith("/conversation")) return {data:{controller:"ready",messages:[],activities:[],hasMoreBefore:false}};
 return {data:{reports}};
}
function show() {
	return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CoordinatorApp openSession={vi.fn()} openSettings={vi.fn()} /></QueryClientProvider>);
}
beforeEach(() => {
	vi.clearAllMocks(); localStorage.clear();
	mocks.workspaces = [{ id: "p", name: "示例项目", kind: "single_repo", path: "/sample/project", sessions: [master] }] as WorkspaceSummary[];
	mocks.ready.mockResolvedValue({ agents: ["codex", "deepseek-harness"].map((id) => ({ id, effectiveReadiness: "ready" })) });
	mocks.post.mockResolvedValue({ data: { state: "accepted" } });
	mocks.get.mockImplementation((route: string) => Promise.resolve(getResponse(route)));
	vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
});
afterEach(() => vi.unstubAllGlobals());

describe("simplified coordinator", () => {
 it("offers AGY and Copilot, removes new Claude choices, and keeps Muse desktop unavailable for dispatch",()=>{
  show();
  const select=screen.getByRole("combobox",{name:"主 agent"});
  expect(select).toHaveTextContent("AGY (Antigravity)");
  expect(select).toHaveTextContent("GitHub Copilot");
  expect(select).not.toHaveTextContent("Claude");
  expect(screen.getByRole("checkbox",{name:"Muse"})).toBeDisabled();
 });
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
		mocks.get.mockImplementation((route: string) => Promise.resolve(getResponse(route,[{ sessionId: "worker", state: "done", createdAt: "2026-10-31T10:00:00Z" }])));
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ runId: "run-x", summary: "页面已归档", tasks: [{ id: "work", sessionId: "worker", status: "completed" }] }) }));
		show(); await screen.findByText("主 agent 已完成验收");
		fireEvent.click(screen.getByRole("button", { name: /查看交付文件/ }));
		expect(mocks.openFolder).toHaveBeenCalledWith({ projectId: "p", runId: "run-x" });
	});
});


describe("ongoing project work", () => {
 it("preserves previous cards and the same main when generating the next round, including reopening",async()=>{
  seed("submitted");mocks.workspaces[0].sessions.push(worker as WorkspaceSummary["sessions"][number]);
  mocks.get.mockImplementation((route:string)=>Promise.resolve(getResponse(route,[{sessionId:"worker",state:"done",createdAt:"2026-10-31T10:00:00Z"}])));
  vi.stubGlobal("fetch",vi.fn().mockImplementation(async(url:string)=>url.includes("collaboration-result-run-x")?{ok:true,text:async()=>JSON.stringify({runId:"run-x",summary:"第一轮完成",tasks:[{id:"work",sessionId:"worker",status:"completed"}]})}:{ok:false,status:404}));
  const view=show();await screen.findByText("主 agent 已完成验收");
  fireEvent.click(screen.getByRole("button",{name:"追加下一轮"}));
  expect(screen.getByLabelText("协作轮次")).toHaveTextContent("第 1 轮 · 示例计划");
  fireEvent.click(screen.getByRole("button",{name:"根据对话生成任务卡"}));
  await waitFor(()=>expect(mocks.post).toHaveBeenCalled());
  const [route,options]=mocks.post.mock.calls[0];
  expect(route).toBe("/api/v1/sessions/{sessionId}/conversation/messages");expect(options.params.path.sessionId).toBe("master");expect(options.body.text).toContain("run-x");
  expect(mocks.post.mock.calls.every(([r])=>r!=="/api/v1/sessions")).toBe(true);
  fireEvent.change(screen.getByLabelText("协作轮次"),{target:{value:"run-x"}});
  expect(screen.getByLabelText("计划名称")).toHaveValue("示例计划");expect(screen.getByLabelText("执行 agent")).toBeDisabled();
  expect(screen.queryByRole("button",{name:/开始协作/})).not.toBeInTheDocument();
  view.unmount();show();expect(screen.getByLabelText("协作轮次")).toHaveTextContent("第 1 轮 · 示例计划");
  expect(JSON.parse(localStorage.getItem("ao:collaboration-draft:v2:p")!).sessionId).toBe("master");
 });
 it("starts a discussion before making cards without creating workers",async()=>{
  mocks.workspaces[0].sessions=[];
  mocks.post.mockResolvedValue({data:{session:{id:"master",harness:"codex"}}});
  show();fireEvent.change(screen.getByLabelText("项目需求"),{target:{value:"先讨论游戏的范围"}});
  fireEvent.click(screen.getByRole("button",{name:"先和主 agent 聊聊"}));
  await screen.findByLabelText("继续和主 agent 讨论");
  expect(mocks.post).toHaveBeenCalledTimes(1);const [route,{body}]=mocks.post.mock.calls[0];expect(route).toBe("/api/v1/sessions");expect(body.kind).toBe("orchestrator");expect(body.prompt).toContain("现在仅讨论");expect(body.prompt).toContain("先讨论游戏的范围");
 });
});
