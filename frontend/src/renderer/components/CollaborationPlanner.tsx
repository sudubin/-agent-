import { useNavigate } from "@tanstack/react-router";
import { collaborationAgents, type CollaborationAgent } from "../lib/collaboration-plan";
import { useCollaborationWorkflow, emptyDraft } from "../hooks/useCollaborationWorkflow";
import { sessionNavigateTarget } from "../lib/navigate-to-session";
import { usesPreviewWorkspaceData } from "../lib/preview-mode";
import type { SessionStatus } from "../types/workspace";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";

const field = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const statusLabels: Record<SessionStatus, string> = { working: "运行中", idle: "空闲，待主 agent 核验", needs_input: "等待输入或审批", exited: "已退出", terminated: "已终止", no_signal: "暂无运行信号", unknown: "状态未知", draft: "草稿", pr_open: "变更已提交", ci_failed: "检查未通过", review_pending: "等待审查", changes_requested: "需要修改", commented: "有新反馈", approved: "审查通过", mergeable: "可以整合", merged: "已整合" };

export function CollaborationPlanner({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
 const navigate = useNavigate();
 const { draft, setDraft, workspace, mainSession, busy, locked, waiting, error, notice, generate, execute, resetPlanning, editTask, newPlan } = useCollaborationWorkflow(projectId, open);
 const showMain = () => {
  const sessionId = draft.sessionId || mainSession?.id;
  if (!sessionId) return;
  onOpenChange(false);
  void navigate(sessionNavigateTarget(projectId, sessionId));
 };
	return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
		<DialogTitle>协作规划 · 分阶段任务卡</DialogTitle>
		<DialogDescription>选择团队 → 主 agent 拆解 → 逐卡分工 → 确认执行</DialogDescription>
		<div className="space-y-5">
			{usesPreviewWorkspaceData && <p role="status" className="rounded-md border border-border p-3 text-sm">界面预览使用演示项目，不会派发真实任务。实际协作请打开桌面开发版。</p>}
			<details open={!draft.plan} className="rounded-lg border border-border p-3 space-y-4">
				<summary className="cursor-pointer text-sm font-medium">团队与需求 · 主 agent：{collaborationAgents.find((a) => a.id === draft.main)?.label} · {draft.roster.length} 位可选执行者</summary>
			<fieldset disabled={busy || waiting || locked || Boolean(draft.plan)} className="grid gap-4 sm:grid-cols-2">
				<label className="space-y-1 text-sm">主 agent<select aria-label="主 agent" className={field} value={draft.main} onChange={(e) => setDraft((d) => ({ ...d, main: e.target.value as CollaborationAgent }))}>{collaborationAgents.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
				<p className="text-sm text-muted-foreground self-end">主 agent 负责规划与验收。子 agent 的职责由你描述，绘图等工具能力需在执行前确认。</p>
				{collaborationAgents.map((a) => { const member = draft.roster.find((r) => r.agent === a.id); return <div key={a.id} className="space-y-2 text-sm">
					<label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(member)} onChange={(e) => setDraft((d) => ({ ...d, roster: e.target.checked ? [...d.roster, { agent: a.id, responsibility: "" }] : d.roster.filter((r) => r.agent !== a.id) }))} />{a.label} 作为可选执行者</label>
					{member && <textarea aria-label={`${a.label} 的职责`} className={field} value={member.responsibility} onChange={(e) => setDraft((d) => ({ ...d, roster: d.roster.map((r) => r.agent === a.id ? { ...r, responsibility: e.target.value } : r) }))} />}
				</div>; })}
				<label className="sm:col-span-2 space-y-1 text-sm">告诉主 agent 你想做什么<textarea className={field} rows={3} value={draft.goal} onChange={(e) => setDraft((d) => ({ ...d, goal: e.target.value }))} /></label>
			</fieldset>
			<div className="flex flex-wrap gap-2">
				<Button disabled={busy || locked || usesPreviewWorkspaceData} onClick={() => void generate()}>{busy ? "处理中…" : waiting ? "恢复同一次规划请求" : mainSession && mainSession.provider !== draft.main ? "切换主 agent 并生成框架" : draft.plan ? "重新生成草案" : "生成任务框架"}</Button>
				{(draft.plan || waiting) && !locked && <Button variant="outline" disabled={busy} onClick={resetPlanning}>{waiting ? "返回团队设置" : "修改团队并重新规划"}</Button>}
			</div>
			</details>
			{usesPreviewWorkspaceData && !draft.plan && <Button variant="outline" onClick={() => setDraft((d) => ({ ...d, main: "codex", roster: emptyDraft().roster, plan: { title: "示例 · 素材、代码与整合", tasks: [
				{ id: "visual", stage: "第一阶段 · 并行准备", title: "准备视觉素材", instructions: "先验证绘图工具，再按需求生成并归档素材。", acceptance: "产物可打开，尺寸和格式符合要求。", agent: "codex", dependsOn: [] },
				{ id: "code", stage: "第一阶段 · 并行准备", title: "实现功能与测试", instructions: "按明确的需求实现代码，并验证主要流程。", acceptance: "功能与相关检查通过，附修改说明。", agent: "deepseek-harness", dependsOn: [] },
				{ id: "integrate", stage: "第二阶段 · 整合验收", title: "整合素材与代码", instructions: "检查前置产物，整合并记录验收结果。", acceptance: "交付可运行的项目与验收记录。", agent: "codex", dependsOn: ["visual", "code"] },
			] } }))}>查看示例任务卡</Button>}
			{(draft.sessionId || mainSession) && <Button variant="outline" onClick={showMain}>查看主 agent 会话</Button>}
			{notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
			{error && <p role="alert" className="whitespace-pre-wrap text-sm text-error">{error}</p>}
			{draft.plan && <>
				<p className="text-sm text-muted-foreground">{draft.plan.tasks.length} 项任务 · {draft.plan.tasks.filter((task) => workspace?.sessions.some((session) => session.title.startsWith(`[${draft.runId}:${task.id}]`))).length} 个执行会话已创建。实际验收结果请查看主 agent 汇总。</p>
				<p className="break-all text-xs text-muted-foreground">项目内统一交付目录：outputs/agent-collaboration/{draft.runId || "示例"}/</p>
				<label className="block space-y-1 text-sm">计划名称<input disabled={locked || busy} className={field} value={draft.plan.title} onChange={(e) => setDraft((d) => ({ ...d, plan: d.plan && { ...d.plan, title: e.target.value } }))} /></label>
				{[...new Set(draft.plan.tasks.map((t) => t.stage))].map((stage) => <section key={stage} className="space-y-3">
					<h3 className="font-semibold">{stage || "未命名阶段"}</h3>
					<div className="grid gap-3 sm:grid-cols-2">{draft.plan!.tasks.filter((t) => t.stage === stage).map((task) => {
						const session = workspace?.sessions.find((s) => s.title.startsWith(`[${draft.runId}:${task.id}]`));
						return <article key={task.id} className="rounded-lg border border-border p-4 space-y-3 bg-card">
							<div className="text-xs text-muted-foreground">{task.id}{session ? ` · 会话：${statusLabels[session.status]}` : locked ? " · 等待主 agent 分派" : " · 草案"}</div>
							<fieldset disabled={locked || busy} className="space-y-2">
								<label className="block text-sm">任务<input className={field} value={task.title} onChange={(e) => editTask(task.id, { title: e.target.value })} /></label>
								<label className="block text-sm">阶段<input className={field} defaultValue={task.stage} onBlur={(e) => editTask(task.id, { stage: e.target.value })} /></label>
								<label className="block text-sm">执行 agent<select className={field} value={task.agent} onChange={(e) => editTask(task.id, { agent: e.target.value as CollaborationAgent })}>{draft.roster.map((a) => <option key={a.agent} value={a.agent}>{collaborationAgents.find((v) => v.id === a.agent)?.label}</option>)}</select></label>
								<label className="block text-sm">任务说明<textarea className={field} value={task.instructions} onChange={(e) => editTask(task.id, { instructions: e.target.value })} /></label>
								<label className="block text-sm">验收条件<textarea className={field} value={task.acceptance} onChange={(e) => editTask(task.id, { acceptance: e.target.value })} /></label>
								<fieldset className="text-sm"><legend>依赖任务（可多选）</legend><div className="flex flex-wrap gap-2">{draft.plan!.tasks.filter((p) => p.id !== task.id).map((parent) => <label key={parent.id} className="flex items-center gap-1"><input type="checkbox" checked={task.dependsOn.includes(parent.id)} onChange={(e) => editTask(task.id, { dependsOn: e.target.checked ? [...task.dependsOn, parent.id] : task.dependsOn.filter((v) => v !== parent.id) })} />{parent.id} · {parent.title}</label>)}</div></fieldset>
								<Button variant="ghost" onClick={() => setDraft((d) => ({ ...d, plan: d.plan && { ...d.plan, tasks: d.plan.tasks.filter((t) => t.id !== task.id).map((t) => ({ ...t, dependsOn: t.dependsOn.filter((p) => p !== task.id) })) } }))}>删除任务</Button>
							</fieldset>
							{session && <Button variant="outline" onClick={() => { onOpenChange(false); void navigate(sessionNavigateTarget(projectId, session.id)); }}>查看真实执行会话</Button>}
						</article>;
					})}</div>
				</section>)}
				<div className="flex flex-wrap gap-2">
					<Button variant="outline" disabled={locked || busy || !draft.roster.length || draft.plan.tasks.length >= 40} onClick={() => setDraft((d) => ({ ...d, plan: d.plan && { ...d.plan, tasks: [...d.plan.tasks, { id: `t-${crypto.randomUUID().slice(0, 8)}`, stage: "新阶段", title: "新任务", instructions: "", acceptance: "", agent: d.roster[0].agent, dependsOn: [] }] } }))}>添加任务卡</Button>
					<Button disabled={busy || draft.state === "submitted" || usesPreviewWorkspaceData} onClick={() => void execute()}>{draft.state === "submitted" ? "已提交协作" : draft.state === "uncertain" ? "恢复同一次执行请求" : "确认分工，开始协作"}</Button>
					{draft.state === "submitted" && <Button variant="outline" onClick={newPlan}>另建计划（保留现有任务）</Button>}
				</div>
			</>}
		</div>
	</DialogContent></Dialog>;
}
