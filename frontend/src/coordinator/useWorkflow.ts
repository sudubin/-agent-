import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient, apiErrorMessage, getApiBaseUrl } from "./api";
import { collaborationAgents, dispatchableAgents, executionHarness, executionPrompt, parseCollaborationPlan, planningPrompt, validateCollaborationPlan, type CollaborationAgent, type CollaborationPlan, type CollaborationTask, type Collaborator } from "../renderer/lib/collaboration-plan";
import { ensureAgentReadiness } from "./data";
import { useWorkspaceQuery, workspaceQueryKeyForHost } from "./data";
import { loadRounds, saveRound, type RoundRecord } from "./roundHistory";
const usesPreviewWorkspaceData = false;

export type Draft = {
	goal: string;
	main: CollaborationAgent;
	roster: Collaborator[];
	plan: CollaborationPlan | null;
	sessionId: string;
	filename: string;
	runId: string;
	createMain: boolean;
	switchMain: boolean;
	projectPath: string;
	executionText: string;
	state: "draft" | "submitted" | "uncertain";
	previousRunId?: string;
};
export const emptyDraft = (): Draft => ({ goal: "", main: "codex", roster: [{ agent: "codex", responsibility: "绘图与视觉素材（执行前验证生图工具）、代码复核" }, { agent: "deepseek-harness", responsibility: "路线明确的代码实现、测试与修复" }], plan: null, sessionId: "", filename: "", runId: "", createMain: false, switchMain: false, projectPath: "", executionText: "", state: "draft" });

export function useCollaborationWorkflow(projectId: string, open = true) {
	const key = `ao:collaboration-draft:v2:${projectId}`;
	const queryClient = useQueryClient();
	const workspace = useWorkspaceQuery({ subscribed: open, includeCloud: false }).data?.find((w) => w.id === projectId);
	const mainSession = workspace?.sessions.find((s) => s.kind === "orchestrator" && !s.isTerminated);
	const [draft, setDraft] = useState<Draft>(() => {
		try {
			const saved = JSON.parse(localStorage.getItem(key) ?? "null");
			if (saved && typeof saved.goal === "string" && (collaborationAgents.some((a) => a.id === saved.main) || saved.main === "claude-code")
				&& Array.isArray(saved.roster) && saved.roster.length <= 5
				&& saved.roster.every((r: Collaborator) => (collaborationAgents.some((a) => a.id === r.agent) || r.agent === "claude-code") && typeof r.responsibility === "string")
				&& ["draft", "submitted", "uncertain"].includes(saved.state)
				&& typeof saved.createMain === "boolean" && typeof saved.switchMain === "boolean"
				&& [saved.sessionId, saved.filename, saved.runId].every((s) => typeof s === "string")) {
				if (saved.state === "draft") {
     if (saved.main === "claude-code") saved.main = "agy";
     saved.roster = saved.roster.map((r: Collaborator) => r.agent === "claude-code" ? { ...r, agent: "agy" } : r);
     if (saved.plan?.tasks) saved.plan.tasks = saved.plan.tasks.map((t: CollaborationTask) => t.agent === "claude-code" ? { ...t, agent: "agy" } : t);
    }
    if (saved.plan) saved.plan = parseCollaborationPlan(JSON.stringify(saved.plan), saved.roster, false);
				return { ...saved, projectPath: typeof saved.projectPath === "string" ? saved.projectPath : "", executionText: typeof saved.executionText === "string" ? saved.executionText : "" } as Draft;
			}
		} catch { /* A stale draft must not prevent opening the project. */ }
		return emptyDraft();
	});
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const [initialHistory] = useState(() => {
		try { return { rounds: loadRounds(projectId), error: "" }; }
		catch (cause) { return { rounds: [] as RoundRecord[], error: cause instanceof Error ? cause.message : String(cause) }; }
	});
	const [rounds, setRounds] = useState(initialHistory.rounds);
	const [historyError, setHistoryError] = useState(initialHistory.error);
	const locked = draft.state !== "draft";
	const submitting = useRef(false);
	const frozen = useRef(false);
	useEffect(() => {
		try { localStorage.setItem(key, JSON.stringify(draft)); }
		catch { setNotice("草案未能保存到本机，请保持此页面打开。"); }
	}, [draft, key]);
	useEffect(() => {
		if (!draft.runId) return;
		try { setRounds(saveRound(projectId, draft)); setHistoryError(""); }
		catch (cause) { setHistoryError(cause instanceof Error ? cause.message : String(cause)); }
	}, [projectId, draft]);
	// Only project-planning data is retained locally. Real task status is read from AO.
	useEffect(() => {
		if (!open || !draft.filename || !draft.sessionId || draft.plan || locked) return;
		let disposed = false;
		let timer: ReturnType<typeof setTimeout>;
		const controller = new AbortController();
		const poll = async () => {
			try {
				const base = getApiBaseUrl();
				if (!base) throw new Error("本地协作服务尚未连接。");
				const response = await fetch(`${base}/api/v1/sessions/${encodeURIComponent(draft.sessionId)}/artifact-files/${encodeURIComponent(draft.filename)}`, { signal: controller.signal });
				if (response.ok) {
					const plan = parseCollaborationPlan(await response.text(), draft.roster);
					if (!disposed) { setDraft((d) => ({ ...d, plan })); setNotice("任务草案已生成。请逐张确认执行 agent 和依赖，再开始协作。"); setError(""); }
					return;
				}
				if (response.status !== 404) throw new Error(`读取草案失败（${response.status}），请查看主 agent 会话。`);
			} catch (cause) {
				if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
			}
			if (!disposed) timer = setTimeout(poll, 4_000);
		};
		void poll();
		return () => { disposed = true; controller.abort(); clearTimeout(timer); };
	}, [open, draft.filename, draft.sessionId, draft.plan, draft.roster, locked]);
	const resetPlanning = () => {
		setDraft((d) => ({ ...d, plan: null, sessionId: "", filename: "", runId: "", createMain: false, switchMain: false, executionText: "" }));
		setError(""); setNotice("已返回团队设置。请在主会话处理当前规划，空闲后可生成新草案。");
	};
	async function generate(fromConversation = false) {
		if (submitting.current || usesPreviewWorkspaceData) return;
		submitting.current = true; setBusy(true); setError("");
		try {
			const goal = draft.goal.trim() || (fromConversation && mainSession ? "根据当前主会话中最近讨论并确认的需求，整理本轮需要新增或修改的任务。结合已有交付继续推进项目。" : "");
			if (!goal || !draft.roster.length) throw new Error("请填写本轮需求，或先和主 agent 讨论，并至少启用一个子 agent。");
			if (!draft.filename || draft.plan) {
				if (mainSession?.activity?.state === "active" || mainSession?.activity?.state === "blocked" || mainSession?.activity?.state === "waiting_input") throw new Error("主 agent 当前有任务或待处理请求，请先在原会话中处理。");
			}
			if (!dispatchableAgents.some((a) => a.id === draft.main) || draft.roster.some((r) => r.agent === "muse-desktop")) throw new Error("Muse 桌面任务接入尚未就绪，请选择其他 agent。");
   const readiness = await ensureAgentReadiness([draft.main, ...draft.roster.map((r) => r.agent)], "launch");
			const main = readiness.agents.find((a) => a.id === draft.main);
			if (!main || main.effectiveReadiness !== "ready") throw new Error("所选主 agent 尚未就绪，请在右上角的 Agent 设置中检查登录。");
			const retrying = Boolean(draft.filename && !draft.plan);
			const runId = retrying ? draft.runId : crypto.randomUUID().slice(0, 8);
			const filename = `collaboration-plan-${runId}.json`;
			const continuation = mainSession ? `\n这是同一个项目的后续规划，请结合本会话已经讨论的需求与约束，沿用已验收结果，按本轮要求继续推进。${draft.previousRunId ? `上一轮标识为 ${JSON.stringify(draft.previousRunId)}，可核对项目 outputs/agent-collaboration/${draft.previousRunId}/ 下的归档。` : ""}` : "";
			const prompt = planningPrompt(goal, draft.roster, filename) + continuation;
			const createMain = retrying ? draft.createMain : !mainSession;
			const switchMain = retrying ? draft.switchMain : Boolean(mainSession && mainSession.provider !== draft.main);
			let sessionId = retrying ? draft.sessionId : mainSession?.id;
			// Save the request identity before dispatch so a closed window can recover it.
			setDraft((d) => ({ ...d, goal, runId, filename, createMain, switchMain, projectPath: retrying ? d.projectPath : workspace?.path ?? "", executionText: "", sessionId: sessionId ?? "", plan: null }));
			if (createMain) {
				// AO serializes main creation per project and returns its existing main on retry.
				// clientRequestId is worker-only; the run name identifies our own recovered main.
				const displayName = `主 agent · 任务规划 [${runId}]`;
				const { data, error } = await apiClient.POST("/api/v1/sessions", { body: { projectId, kind: "orchestrator", harness: executionHarness(draft.main), mode: "chat", displayName, prompt } });
				if (error || !data) throw new Error(apiErrorMessage(error, "无法创建主 agent。"));
				if (data.session.displayName !== displayName || data.session.harness !== draft.main) {
					setDraft((d) => ({ ...d, filename: "", runId: "", sessionId: data.session.id, createMain: false }));
					void queryClient.invalidateQueries({ queryKey: workspaceQueryKeyForHost() });
					throw new Error("项目已出现其他主 agent。请等待会话列表刷新，再确认所选主 agent 并重新规划。");
				}
				sessionId = data.session.id;
			} else if (sessionId && switchMain) {
				const { error } = await apiClient.POST("/api/v1/sessions/{sessionId}/provider-switch", { params: { path: { sessionId } }, body: { targetHarness: draft.main, idempotencyKey: `collaboration-switch-${runId}`, message: { text: prompt, clientMessageId: `collaboration-plan-${runId}` } } });
				if (error) throw new Error(apiErrorMessage(error, "无法切换主 agent，请查看原会话。"));
			} else if (sessionId) {
				const { error } = await apiClient.POST("/api/v1/sessions/{sessionId}/conversation/messages", { params: { path: { sessionId } }, body: { text: prompt, clientMessageId: `collaboration-plan-${runId}` } });
				if (error) throw new Error(apiErrorMessage(error, "无法发送规划请求。"));
			} else throw new Error("无法确定规划会话，请打开主 agent 会话检查。");
			setDraft((d) => ({ ...d, sessionId: sessionId!, filename, runId, plan: null }));
			setNotice("主 agent 正在规划。此阶段不会要求它创建执行任务；草案文件生成后自动显示。可打开主会话处理启动或审批提示。");
			void queryClient.invalidateQueries({ queryKey: workspaceQueryKeyForHost() });
		} catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
		finally { submitting.current = false; setBusy(false); }
	}
	async function startDiscussion() {
		if (submitting.current) return;
		if (mainSession) { setNotice("可以在项目对话中继续和主 agent 沟通。"); return; }
		submitting.current = true; setBusy(true); setError("");
		try {
			if (!draft.goal.trim()) throw new Error("先写下你想和主 agent 讨论的需求。");
			const readiness = await ensureAgentReadiness([draft.main], "launch");
			if (!dispatchableAgents.some(a => a.id === draft.main) || !readiness.agents.some(a => a.id === draft.main && a.effectiveReadiness === "ready")) throw new Error("所选主 agent 尚未就绪，请先检查连接。");
			const prompt = `请担任这个项目的主 agent，与用户持续沟通、澄清需求。现在仅讨论，暂不执行、修改项目代码或创建 worker。用户会在协作台生成并确认任务卡后授权协作。\n用户本轮消息：\n${draft.goal.trim()}`;
			const { data, error } = await apiClient.POST("/api/v1/sessions", { body: { projectId, kind: "orchestrator", harness: executionHarness(draft.main), mode: "chat", displayName: "主 agent · 项目讨论", prompt } });
			if (error || !data) throw new Error(apiErrorMessage(error, "无法开始项目对话。"));
			setDraft(d => ({ ...d, sessionId: data.session.id }));
			setNotice("项目对话已打开。可以多轮讨论，再根据对话生成任务卡。");
			void queryClient.invalidateQueries({ queryKey: workspaceQueryKeyForHost() });
		} catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
		finally { submitting.current = false; setBusy(false); }
	}
	async function execute() {
		if (submitting.current || frozen.current || usesPreviewWorkspaceData || draft.state === "submitted" || !draft.plan || !draft.sessionId) return;
		if (mainSession?.id === draft.sessionId && mainSession.provider !== draft.main) { setError("主 agent 已在其他位置切换，请修改团队并重新规划。"); return; }
		const errors = validateCollaborationPlan(draft.plan, draft.roster);
		if (errors.length) { setError(errors.join("\n")); return; }
		submitting.current = true; setBusy(true); setError("");
		try {
			const readiness = await ensureAgentReadiness([...new Set(draft.plan.tasks.map((t) => t.agent))], "launch");
			if (draft.plan.tasks.some((t) => !readiness.agents.some((a) => a.id === t.agent && a.effectiveReadiness === "ready"))) throw new Error("有执行 agent 尚未登录或未就绪，请处理后再开始。");
			// Retain the exact message on ambiguous transport failure; retry uses the same durable identity.
			const text = draft.executionText || executionPrompt(draft.plan, draft.runId, draft.projectPath);
			setDraft((d) => ({ ...d, state: "uncertain", executionText: text }));
			const { error } = await apiClient.POST("/api/v1/sessions/{sessionId}/conversation/messages", { params: { path: { sessionId: draft.sessionId } }, body: { text, clientMessageId: `collaboration-run-${draft.runId}` } });
			if (error) throw new Error(apiErrorMessage(error, "执行请求未能确认，请查看主 agent 会话；重试将恢复同一次请求。"));
			frozen.current = true;
			setDraft((d) => ({ ...d, state: "submitted" }));
			setNotice("已将你确认的任务卡交给主 agent。主 agent 将安排执行、处理回报，并统一验收归档。");
		} catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
		finally { submitting.current = false; setBusy(false); }
	}
	const editTask = (id: string, values: Partial<CollaborationTask>) => setDraft((d) => ({ ...d, plan: d.plan && { ...d.plan, tasks: d.plan.tasks.map((t) => t.id === id ? { ...t, ...values } : t) } }));
	const waiting = Boolean(draft.filename && !draft.plan);
	const newPlan = () => {
		if (busy || submitting.current || draft.state === "uncertain") return;
		try {
			if (draft.runId) setRounds(saveRound(projectId, draft));
			frozen.current = false; setError(""); setHistoryError(""); setNotice("上一轮任务卡已保留，主 agent 对话继续沿用。可以讨论新需求，再生成下一轮任务卡。");
			setDraft(d => ({ ...emptyDraft(), main: d.main, roster: d.roster, sessionId: mainSession?.id || d.sessionId, projectPath: workspace?.path || d.projectPath, previousRunId: d.runId || d.previousRunId }));
		} catch (cause) { setHistoryError(cause instanceof Error ? cause.message : String(cause)); }
	};
	return { draft, setDraft, workspace, mainSession, rounds, historyError, busy, locked, waiting, error, notice, generate, startDiscussion, execute, resetPlanning, editTask, newPlan };
}
