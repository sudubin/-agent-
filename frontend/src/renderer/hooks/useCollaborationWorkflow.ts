import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient, apiErrorMessage, getApiBaseUrl } from "../lib/api-client";
import { collaborationAgents, executionHarness, executionPrompt, parseCollaborationPlan, planningPrompt, validateCollaborationPlan, type CollaborationAgent, type CollaborationPlan, type CollaborationTask, type Collaborator } from "../lib/collaboration-plan";
import { ensureAgentReadiness } from "./useAgentReadinessQuery";
import { useWorkspaceQuery, workspaceQueryKeyForHost } from "./useWorkspaceQuery";
import { usesPreviewWorkspaceData } from "../lib/preview-mode";

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
			if (saved && typeof saved.goal === "string" && collaborationAgents.some((a) => a.id === saved.main)
				&& Array.isArray(saved.roster) && saved.roster.length <= 3
				&& saved.roster.every((r: Collaborator) => collaborationAgents.some((a) => a.id === r.agent) && typeof r.responsibility === "string")
				&& ["draft", "submitted", "uncertain"].includes(saved.state)
				&& typeof saved.createMain === "boolean" && typeof saved.switchMain === "boolean"
				&& [saved.sessionId, saved.filename, saved.runId].every((s) => typeof s === "string")) {
				if (saved.plan) saved.plan = parseCollaborationPlan(JSON.stringify(saved.plan), saved.roster, false);
				return { ...saved, projectPath: typeof saved.projectPath === "string" ? saved.projectPath : "", executionText: typeof saved.executionText === "string" ? saved.executionText : "" } as Draft;
			}
		} catch { /* A stale draft must not prevent opening the project. */ }
		return emptyDraft();
	});
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const locked = draft.state !== "draft";
	const submitting = useRef(false);
	const frozen = useRef(false);
	useEffect(() => {
		try { localStorage.setItem(key, JSON.stringify(draft)); }
		catch { setNotice("草案未能保存到本机，请保持此页面打开。"); }
	}, [draft, key]);
	// Only project-planning data is retained locally. Real task status is read from AO.
	useEffect(() => {
		if (!open || !draft.filename || !draft.sessionId || draft.plan || locked) return;
		let disposed = false;
		let timer: ReturnType<typeof setTimeout>;
		const controller = new AbortController();
		const poll = async () => {
			try {
				const base = getApiBaseUrl();
				if (!base) throw new Error("AO 数据服务尚未连接。");
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
	async function generate() {
		if (submitting.current || usesPreviewWorkspaceData) return;
		submitting.current = true; setBusy(true); setError("");
		try {
			if (!draft.goal.trim() || !draft.roster.length) throw new Error("请填写项目需求，并至少启用一个子 agent。");
			if (!draft.filename || draft.plan) {
				if (mainSession?.activity?.state === "active" || mainSession?.activity?.state === "blocked" || mainSession?.activity?.state === "waiting_input") throw new Error("主 agent 当前有任务或待处理请求，请先在原会话中处理。");
			}
			const readiness = await ensureAgentReadiness([draft.main, ...draft.roster.map((r) => r.agent)], "launch");
			const main = readiness.agents.find((a) => a.id === draft.main);
			if (!main || main.effectiveReadiness !== "ready") throw new Error("所选主 agent 尚未就绪，请先在 AO 设置中检查安装和登录。");
			const retrying = Boolean(draft.filename && !draft.plan);
			const runId = retrying ? draft.runId : crypto.randomUUID().slice(0, 8);
			const filename = `collaboration-plan-${runId}.json`;
			const prompt = planningPrompt(draft.goal, draft.roster, filename);
			const createMain = retrying ? draft.createMain : !mainSession;
			const switchMain = retrying ? draft.switchMain : Boolean(mainSession && mainSession.provider !== draft.main);
			let sessionId = retrying ? draft.sessionId : mainSession?.id;
			// Save the request identity before dispatch so a closed window can recover it.
			setDraft((d) => ({ ...d, runId, filename, createMain, switchMain, projectPath: retrying ? d.projectPath : workspace?.path ?? "", executionText: "", sessionId: sessionId ?? "", plan: null }));
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
			} else throw new Error("无法确定规划会话，请在 AO 中检查主 agent。");
			setDraft((d) => ({ ...d, sessionId: sessionId!, filename, runId, plan: null }));
			setNotice("主 agent 正在规划。此阶段不会要求它创建执行任务；草案文件生成后自动显示。可打开主会话处理启动或审批提示。");
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
			setNotice("已将你确认的任务卡交给主 agent。AO 负责真实派单、审批和结果回收；下方仅显示匹配到的真实会话。");
		} catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
		finally { submitting.current = false; setBusy(false); }
	}
	const editTask = (id: string, values: Partial<CollaborationTask>) => setDraft((d) => ({ ...d, plan: d.plan && { ...d.plan, tasks: d.plan.tasks.map((t) => t.id === id ? { ...t, ...values } : t) } }));
	const waiting = Boolean(draft.filename && !draft.plan);
	const newPlan = () => { frozen.current = false; setError(""); setNotice("现有任务已保留，可以规划新的工作。"); setDraft((d) => ({ ...emptyDraft(), main: d.main, roster: d.roster })); };
	return { draft, setDraft, workspace, mainSession, busy, locked, waiting, error, notice, generate, execute, resetPlanning, editTask, newPlan };
}
