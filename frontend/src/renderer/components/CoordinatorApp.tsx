import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, ChevronRight, CircleHelp, FolderOpen, LoaderCircle, Network, Plus, Settings2, Sparkles, Trash2 } from "lucide-react";
import { aoBridge } from "../lib/bridge";
import { apiClient, apiErrorCode, apiErrorMessage, getApiBaseUrl } from "../lib/api-client";
import { collaborationAgents, parseCollaborationResult, type CollaborationAgent, type CollaborationPlan, type CollaborationTask, type CollaborationResult } from "../lib/collaboration-plan";
import { useDaemonStatus } from "../hooks/useDaemonStatus";
import { useWorkspaceQuery, workspaceQueryKeyForHost } from "../hooks/useWorkspaceQuery";
import { cacheAgentReadiness, ensureAgentReadiness, useAgentReadinessQuery } from "../hooks/useAgentReadinessQuery";
import { useCollaborationWorkflow } from "../hooks/useCollaborationWorkflow";
import { DaemonFailureBanner } from "./DaemonFailureBanner";
import { QuitConfirmDialog } from "./QuitConfirmDialog";
import type { WorkspaceSession } from "../types/workspace";
import "./coordinator.css";

type Navigation = { openSession: (projectId: string, sessionId: string) => void; openSettings: (agent?: string) => void };
const agentLabel = (id: string) => collaborationAgents.find((a) => a.id === id)?.label ?? id;

export function CoordinatorApp({ openSession, openSettings }: Navigation) {
	const queryClient = useQueryClient();
	const status = useDaemonStatus(queryClient);
	const ready = status.state === "ready";
	const projects = useWorkspaceQuery({ enabled: ready, subscribed: ready, includeCloud: false });
	const localProjects = (projects.data ?? []).filter((p) => p.kind !== "scratch");
	const [projectId, setProjectId] = useState(() => localStorage.getItem("coordinator:last-project") ?? "");
	const [adding, setAdding] = useState(false);
	const [pendingFolder, setPendingFolder] = useState("");
	const [error, setError] = useState("");
	const [quit, setQuit] = useState<{ keepsRunning: boolean } | null>(null);
	const active = localProjects.find((p) => p.id === projectId) ?? localProjects[0];
	useEffect(() => { if (active) localStorage.setItem("coordinator:last-project", active.id); }, [active?.id]);
	useEffect(() => aoBridge.app.onQuitConfirmRequest(setQuit), []);
	async function registerFolder(folder: string, initialize = false) {
		setAdding(true); setError("");
		try {
			if (initialize) {
				const initialized = await apiClient.POST("/api/v1/projects/initialize", { body: { path: folder } });
				if (initialized.error) throw new Error(apiErrorMessage(initialized.error, "暂时无法准备这个文件夹。"));
			}
			const existing = localProjects.find((p) => p.path === folder);
			if (existing) { setProjectId(existing.id); setPendingFolder(""); return; }
			const branch = await aoBridge.app.getRepositoryBranch(folder).catch(() => undefined);
			const { data, error: apiError } = await apiClient.POST("/api/v1/projects", { body: { path: folder, config: { defaultBranch: branch || "main" } } });
			if (apiError || !data) {
				if (["NOT_A_GIT_REPO", "PROJECT_UNBORN"].includes(apiErrorCode(apiError) ?? "")) { setPendingFolder(folder); return; }
				throw new Error(apiErrorMessage(apiError, "无法打开这个项目。"));
			}
			setProjectId(data.project.id); setPendingFolder("");
			await queryClient.invalidateQueries({ queryKey: workspaceQueryKeyForHost() });
		} catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
		finally { setAdding(false); }
	}
	async function chooseProject() {
		try {
			const folder = await aoBridge.app.chooseDirectory({ title: "选择大家共享的项目文件夹" });
			if (folder) await registerFolder(folder);
		} catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
	}
	return <div className="coordinator-app">
		<header className="coordinator-topbar">
			<div className="coordinator-brand"><span className="coordinator-mark"><Network size={21} /></span><strong>协作台</strong><span className="coordinator-brand-note">你的本地 agent 团队</span></div>
			<div className="coordinator-topbar-actions"><span className={`coordinator-connection ${ready ? "is-ready" : ""}`}><i />{ready ? "已就绪" : "正在准备…"}</span><button className="coordinator-icon-button" aria-label="Agent 设置" onClick={() => openSettings()}><Settings2 size={18} /></button></div>
		</header>
		<DaemonFailureBanner status={status} />
		<div className="coordinator-scroll"><main className="coordinator-content">
			{error && <div role="alert" className="coordinator-alert">{error}</div>}
			{pendingFolder && <section className="coordinator-prepare"><FolderOpen size={25} /><div><h2>为这个文件夹启用协作</h2><p>建立本地版本记录，让各个 agent 独立工作、最后整合。文件保留在本机。</p><code>{pendingFolder}</code><div className="coordinator-button-row"><button className="coordinator-primary" disabled={adding} onClick={() => void registerFolder(pendingFolder, true)}>{adding ? "正在准备…" : "启用并打开项目"}</button><button className="coordinator-secondary" disabled={adding} onClick={() => setPendingFolder("")}>取消</button></div></div></section>}
			{!active ? <section className="coordinator-welcome"><div className="coordinator-welcome-symbol"><Network size={38} /></div><p className="coordinator-eyebrow">一个项目，一支团队</p><h1>让多个 agent 一起完成项目</h1><p>选一个主 agent，告诉它需求，再确认每张任务卡由谁完成。</p><button className="coordinator-primary coordinator-large" disabled={!ready || adding} onClick={() => void chooseProject()}><FolderOpen size={18} />{adding ? "正在打开…" : "选择项目文件夹"}<ArrowRight size={17} /></button><div className="coordinator-welcome-steps"><span>01 选择项目</span><ChevronRight size={15} /><span>02 确认分工</span><ChevronRight size={15} /><span>03 等待交付</span></div></section> : <>
				<div className="coordinator-project-bar"><div><p className="coordinator-eyebrow">当前共享项目</p><select aria-label="共享项目" value={active.id} onChange={(e) => setProjectId(e.target.value)}>{localProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><p className="coordinator-project-path" title={active.path}>{active.path}</p></div><button className="coordinator-secondary" disabled={adding} onClick={() => void chooseProject()}><FolderOpen size={16} />换个项目</button></div>
				<CoordinatorProject key={active.id} projectId={active.id} openSession={openSession} openSettings={openSettings} />
			</>}
		</main></div>
		<QuitConfirmDialog open={quit !== null} keepsRunning={quit?.keepsRunning} onResolve={(confirmed) => { aoBridge.app.resolveQuitConfirm(confirmed); setQuit(null); }} />
	</div>;
}

function useRunProgress(projectId: string, sessionId: string, runId: string, plan: CollaborationPlan | null, enabled: boolean) {
	return useQuery({ queryKey: ["coordinator-progress", projectId, sessionId, runId], enabled: enabled && Boolean(sessionId && runId && plan), refetchInterval: 4_000,
		queryFn: async () => {
			const { data, error } = await apiClient.GET("/api/v1/reports", { params: { query: { projectId } } });
			if (error) throw new Error(apiErrorMessage(error, "暂时无法读取进度。"));
			const response = await fetch(`${getApiBaseUrl()}/api/v1/sessions/${encodeURIComponent(sessionId)}/artifact-files/collaboration-result-${encodeURIComponent(runId)}.json`);
			let result: CollaborationResult | null = null;
			if (response.ok) {
				if (plan) result = parseCollaborationResult(await response.text(), plan, runId);
			} else if (response.status !== 404) throw new Error("暂时无法读取主 agent 的验收结果。");
			return { reports: data?.reports ?? [], result };
		},
	});
}

function CoordinatorProject({ projectId, openSession, openSettings }: Navigation & { projectId: string }) {
	const flow = useCollaborationWorkflow(projectId);
	const { draft, setDraft, workspace, mainSession, busy, locked, waiting, error, notice, generate, execute, resetPlanning, editTask, newPlan } = flow;
	const queryClient = useQueryClient();
	const readiness = useAgentReadinessQuery();
	const [localError, setLocalError] = useState("");
	useEffect(() => { void ensureAgentReadiness(collaborationAgents.map((a) => a.id), "display").then((r) => cacheAgentReadiness(queryClient, r)).catch(() => undefined); }, [queryClient]);
	const progress = useRunProgress(projectId, draft.sessionId, draft.runId, draft.plan, locked);
	const sessionFor = (task: CollaborationTask) => workspace?.sessions.find((s) => s.title.startsWith(`[${draft.runId}:${task.id}]`));
	const completed = (task: CollaborationTask) => {
		const session = sessionFor(task);
		return session?.provider === task.agent && progress.data?.reports.some((r) => r.sessionId === session.id && r.state === "done")
			&& progress.data?.result?.tasks.some((t) => t.id === task.id && t.sessionId === session.id && t.status === "completed");
	};
	const doneCount = draft.plan?.tasks.filter(completed).length ?? 0;
	const allDone = Boolean(draft.plan?.tasks.length && doneCount === draft.plan.tasks.length);
	const mainId = draft.sessionId || mainSession?.id;
	const taskState = (task: CollaborationTask): { label: string; kind: string } => {
		if (!locked) return { label: "待确认", kind: "draft" };
		if (completed(task)) return { label: "已验收", kind: "done" };
		if (progress.data?.result?.tasks.some((t) => t.id === task.id && t.status === "blocked")) return { label: "主 agent 报告受阻", kind: "blocked" };
		const session = sessionFor(task);
		if (!session) return { label: task.dependsOn.length ? "等待前置任务" : "等待分派", kind: "pending" };
		if (session.provider !== task.agent) return { label: "执行者不一致，请核对", kind: "blocked" };
		if (["blocked", "waiting_input"].includes(session.activity?.state ?? "")) return { label: "需要你处理", kind: "blocked" };
		const report = progress.data?.reports.filter((r) => r.sessionId === session.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
		if (report?.state === "done") return { label: "已交付，等待验收", kind: "delivered" };
		if (report?.state === "blocked") return { label: "任务受阻", kind: "blocked" };
		if (["exited", "terminated", "no_signal"].includes(session.status)) return { label: "会话已暂停，请查看", kind: "blocked" };
		return { label: session.activity?.state === "active" ? "进行中" : "等待主 agent", kind: session.activity?.state === "active" ? "running" : "pending" };
	};
	async function openFolder(run = false) {
		try { setLocalError(""); await aoBridge.app.openCollaborationFolder({ projectId, ...(run ? { runId: draft.runId } : {}) }); }
		catch (cause) { setLocalError(cause instanceof Error ? cause.message : String(cause)); }
	}
	async function resumeMain() {
		if (!mainId) return;
		try { const { error } = await apiClient.POST("/api/v1/sessions/{sessionId}/resume-agent", { params: { path: { sessionId: mainId } } }); if (error) throw new Error(apiErrorMessage(error)); }
		catch (cause) { setLocalError(cause instanceof Error ? cause.message : String(cause)); }
	}
	const needsMain = locked && !allDone && mainSession && ["exited", "no_signal"].includes(mainSession.status);
	return <>
		<div className="coordinator-steps"><span className={!draft.plan ? "active" : "complete"}><b>{draft.plan ? <Check size={13} /> : 1}</b>说明需求</span><i /><span className={draft.plan && !locked ? "active" : locked ? "complete" : ""}><b>{locked ? <Check size={13} /> : 2}</b>确认分工</span><i /><span className={locked ? "active" : ""}><b>3</b>执行与交付</span></div>
		{!draft.plan ? <section className="coordinator-brief-grid">
			<aside className="coordinator-team"><h2>谁来带队</h2><p>主 agent 拆解任务，并负责最后整合。</p><label className="coordinator-label">主 agent<select aria-label="主 agent" disabled={busy || waiting} value={draft.main} onChange={(e) => setDraft((d) => ({ ...d, main: e.target.value as CollaborationAgent }))}>{collaborationAgents.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
				<h3>可派发的执行者</h3>{collaborationAgents.map((a) => { const member = draft.roster.find((r) => r.agent === a.id); const agent = readiness.data?.agents.find((r) => r.id === a.id); return <div className={`coordinator-member ${member ? "enabled" : ""}`} key={a.id}><div className="coordinator-member-heading"><label><input type="checkbox" disabled={busy || waiting} checked={Boolean(member)} onChange={(e) => setDraft((d) => ({ ...d, roster: e.target.checked ? [...d.roster, { agent: a.id, responsibility: "" }] : d.roster.filter((r) => r.agent !== a.id) }))} />{a.label}</label><button onClick={() => openSettings(a.id)}>{agent?.effectiveReadiness === "ready" ? <span className="coordinator-ready-tag">已就绪</span> : agent ? "去配置" : "检测中"}</button></div>{member && <textarea aria-label={`${a.label} 的职责`} placeholder="告诉主 agent，它适合做什么" disabled={busy || waiting} rows={2} value={member.responsibility} onChange={(e) => setDraft((d) => ({ ...d, roster: d.roster.map((r) => r.agent === a.id ? { ...r, responsibility: e.target.value } : r) }))} />}</div>; })}
			</aside>
			<div className="coordinator-brief"><p className="coordinator-eyebrow">开始一个协作计划</p><h1>这次，你想完成什么？</h1><p>像平时和主 agent 聊天一样，说明目标、范围和交付要求。</p><label className="coordinator-sr-only" htmlFor="coordinator-goal">项目需求</label><textarea id="coordinator-goal" className="coordinator-goal" placeholder="例如：帮我开发一个展示网站。Codex 准备视觉素材，DSH 实现页面；你负责规划、检查并整合。先给我任务卡，让我确认分工。" disabled={busy || waiting} value={draft.goal} onChange={(e) => setDraft((d) => ({ ...d, goal: e.target.value }))} />
				{waiting ? <div className="coordinator-planning"><LoaderCircle className="coordinator-spin" size={20} /><strong>主 agent 正在拆解任务</strong><p>草案准备好后会自动出现，再由你确认分工。</p><div className="coordinator-button-row"><button className="coordinator-secondary" disabled={busy} onClick={() => void generate()}>继续当前规划</button><button className="coordinator-text-button" disabled={busy} onClick={resetPlanning}>返回修改</button></div></div> : <button className="coordinator-primary coordinator-large" disabled={busy || !draft.goal.trim() || !draft.roster.length} onClick={() => void generate()}>{busy ? <LoaderCircle className="coordinator-spin" size={18} /> : <Sparkles size={18} />}{busy ? "正在连接主 agent…" : mainSession && mainSession.provider !== draft.main ? "切换主 agent 并生成任务卡" : "生成任务卡"}<ArrowRight size={17} /></button>}
				<p className="coordinator-quiet"><CircleHelp size={14} />先规划，确认分工后再开始执行。绘图任务会先验证工具能力。</p>
			</div>
		</section> : <>
			<div className="coordinator-plan-heading"><div><p className="coordinator-eyebrow">{locked ? "团队正在协作" : "由你确认每张卡的执行者"}</p><input aria-label="计划名称" className="coordinator-plan-title" disabled={locked || busy} value={draft.plan.title} onChange={(e) => setDraft((d) => ({ ...d, plan: d.plan && { ...d.plan, title: e.target.value } }))} /><p>主 agent：{agentLabel(draft.main)} <span>·</span> {draft.plan.tasks.length} 项任务 {locked && <><span>·</span> {doneCount} 项已验收</>}</p></div><div className="coordinator-button-row">{!locked && <button className="coordinator-secondary" disabled={busy} onClick={resetPlanning}><Settings2 size={15} />修改需求与团队</button>}<button className="coordinator-secondary" onClick={() => void openFolder()}><FolderOpen size={15} />打开项目</button></div></div>
			{locked && <div className={`coordinator-run-banner ${allDone ? "finished" : ""}`}><span className="coordinator-run-symbol">{allDone ? <Check size={22} /> : <Network size={22} />}</span><div><strong>{allDone ? "主 agent 已完成验收" : "主 agent 正在协调执行与验收"}</strong><p>{allDone ? progress.data?.result?.summary : "进度来自真实执行会话。子任务交付后，由主 agent 检查、整合并归档。"}</p></div>{allDone && <button className="coordinator-primary" onClick={() => void openFolder(true)}>查看交付文件<ArrowRight size={15} /></button>}</div>}
			{[...new Set(draft.plan.tasks.map((t) => t.stage))].map((stage, index) => <section className="coordinator-stage" key={stage}><div className="coordinator-stage-heading"><span>{String(index + 1).padStart(2, "0")}</span><h2>{stage || "未命名阶段"}</h2></div><div className="coordinator-cards">{draft.plan!.tasks.filter((t) => t.stage === stage).map((task) => <TaskCard key={task.id} task={task} tasks={draft.plan!.tasks} roster={draft.roster} state={taskState(task)} session={sessionFor(task)} disabled={locked || busy} onEdit={(values) => editTask(task.id, values)} onDelete={() => setDraft((d) => ({ ...d, plan: d.plan && { ...d.plan, tasks: d.plan.tasks.filter((t) => t.id !== task.id).map((t) => ({ ...t, dependsOn: t.dependsOn.filter((id) => id !== task.id) })) } }))} onOpen={(id) => openSession(projectId, id)} />)}</div></section>)}
			{!locked && <button className="coordinator-add-task" disabled={busy || draft.plan.tasks.length >= 40} onClick={() => setDraft((d) => ({ ...d, plan: d.plan && { ...d.plan, tasks: [...d.plan.tasks, { id: `task-${crypto.randomUUID().slice(0, 8)}`, stage: "补充任务", title: "新任务", instructions: "", acceptance: "", agent: d.roster[0].agent, dependsOn: [] }] } }))}><Plus size={16} />添加任务卡</button>}
		</>}
		{(error || localError || progress.error) && <div role="alert" className="coordinator-alert">{error || localError || progress.error?.message}</div>}
		{notice && <p role="status" className="coordinator-notice">{notice}</p>}
		<div className="coordinator-footer"><div>{mainId ? <button className="coordinator-text-button" onClick={() => openSession(projectId, mainId)}>查看主 agent / 处理审批<ChevronRight size={15} /></button> : <span>各自工作，统一交付到项目文件夹。</span>}{needsMain && <button className="coordinator-secondary" onClick={() => void resumeMain()}>恢复主 agent</button>}</div><div className="coordinator-button-row">{draft.plan && !locked && <><span className="coordinator-footer-hint">执行顺序由任务依赖决定</span><button className="coordinator-primary coordinator-large" disabled={busy} onClick={() => void execute()}>{busy ? <LoaderCircle className="coordinator-spin" size={17} /> : <ArrowRight size={17} />}开始协作</button></>}{draft.state === "uncertain" && <button className="coordinator-primary" disabled={busy} onClick={() => void execute()}>重试提交原计划</button>}{draft.state === "submitted" && <button className="coordinator-secondary" onClick={newPlan}><Plus size={16} />新建计划</button>}</div></div>
	</>;
}

function TaskCard({ task, tasks, roster, state, session, disabled, onEdit, onDelete, onOpen }: {
	task: CollaborationTask; tasks: CollaborationTask[]; roster: { agent: CollaborationAgent }[]; state: { label: string; kind: string }; session?: WorkspaceSession; disabled: boolean;
	onEdit: (values: Partial<CollaborationTask>) => void; onDelete: () => void; onOpen: (sessionId: string) => void;
}) {
	return <article className={`coordinator-task ${state.kind}`}><div className="coordinator-task-top"><span className={`coordinator-task-status ${state.kind}`}><i />{state.label}</span><span className="coordinator-task-id">{task.id}</span></div><input aria-label="任务名称" className="coordinator-task-title" disabled={disabled} value={task.title} onChange={(e) => onEdit({ title: e.target.value })} /><label className="coordinator-label coordinator-agent-picker">交给谁<select aria-label="执行 agent" disabled={disabled} value={task.agent} onChange={(e) => onEdit({ agent: e.target.value as CollaborationAgent })}>{roster.map((r) => <option key={r.agent} value={r.agent}>{agentLabel(r.agent)}</option>)}</select></label><p className="coordinator-task-description">{task.instructions || "展开填写任务说明与验收条件"}</p>{task.dependsOn.length > 0 && <div className="coordinator-dependency-summary">依赖：{task.dependsOn.map((id) => tasks.find((t) => t.id === id)?.title ?? id).join("、")}</div>}<details className="coordinator-task-details"><summary>{disabled ? "查看任务要求" : "任务说明、验收与依赖"}<ChevronRight size={14} /></summary><fieldset disabled={disabled}><label className="coordinator-label">阶段<input aria-label="任务阶段" defaultValue={task.stage} onBlur={(e) => onEdit({ stage: e.target.value })} /></label><label className="coordinator-label">任务说明<textarea aria-label="任务说明" rows={4} value={task.instructions} onChange={(e) => onEdit({ instructions: e.target.value })} /></label><label className="coordinator-label">验收条件<textarea aria-label="验收条件" rows={3} value={task.acceptance} onChange={(e) => onEdit({ acceptance: e.target.value })} /></label><fieldset className="coordinator-dependencies"><legend>前置任务</legend>{tasks.filter((t) => t.id !== task.id).map((p) => <label key={p.id}><input type="checkbox" checked={task.dependsOn.includes(p.id)} onChange={(e) => onEdit({ dependsOn: e.target.checked ? [...task.dependsOn, p.id] : task.dependsOn.filter((id) => id !== p.id) })} />{p.title}</label>)}{tasks.length === 1 && <span>暂无其他任务</span>}</fieldset>{!disabled && <button className="coordinator-delete" onClick={onDelete}><Trash2 size={13} />删除此任务</button>}</fieldset></details>{session && <button className="coordinator-session-link" onClick={() => onOpen(session.id)}>查看运行 / 处理请求<ChevronRight size={14} /></button>}</article>;
}

export function CoordinatorAdvancedHeader({ onBack }: { onBack: () => void }) {
	return <header className="coordinator-advanced-header"><button className="coordinator-secondary" onClick={onBack}><ArrowLeft size={16} />返回协作台</button><span>会话与 agent 设置</span></header>;
}
