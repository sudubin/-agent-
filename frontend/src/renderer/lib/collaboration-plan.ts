/** Editable planning data. Execution and worker lifecycle remain owned by AO. */
export const collaborationAgents = [
	{ id: "agy", label: "AGY (Antigravity)" },
	{ id: "codex", label: "Codex" },
	{ id: "deepseek-harness", label: "DeepSeek Harness" },
 { id: "copilot", label: "GitHub Copilot" },
 { id: "muse-desktop", label: "Muse" },
] as const;
export const dispatchableAgents = collaborationAgents.filter((a) => a.id !== "muse-desktop");
export type CollaborationAgent = typeof collaborationAgents[number]["id"] | "claude-code"; // Retained history only; no new Claude option.
export function executionHarness(agent: CollaborationAgent): Exclude<CollaborationAgent, "muse-desktop"> {
 if (agent === "muse-desktop") throw new Error("Muse 桌面任务接入尚未就绪。");
 return agent;
}
export type Collaborator = { agent: CollaborationAgent; responsibility: string };
export type CollaborationTask = {
	id: string;
	stage: string;
	title: string;
	instructions: string;
	agent: CollaborationAgent;
	dependsOn: string[];
	acceptance: string;
};
export type CollaborationPlan = { title: string; tasks: CollaborationTask[] };
export type CollaborationResult = { runId: string; summary: string; tasks: { id: string; sessionId: string; status: "completed" | "blocked" | "pending" }[] };

export function parseCollaborationResult(raw: string, plan: CollaborationPlan, runId: string): CollaborationResult {
	if (raw.length > 100_000) throw new Error("验收结果过大，请查看主 agent 会话。");
	const value: unknown = JSON.parse(raw);
	if (!value || typeof value !== "object") throw new Error("验收结果格式不正确。");
	const r = value as Record<string, unknown>;
	if (r.runId !== runId || typeof r.summary !== "string" || !r.summary.trim() || !Array.isArray(r.tasks) || r.tasks.length !== plan.tasks.length) throw new Error("验收结果与当前计划不匹配。");
	const tasks = r.tasks.map((value: unknown) => {
		if (!value || typeof value !== "object") throw new Error("验收任务格式不正确。");
		const task = value as Record<string, unknown>;
		if (typeof task.id !== "string" || !plan.tasks.some((t) => t.id === task.id) || typeof task.sessionId !== "string" || !["completed", "blocked", "pending"].includes(String(task.status))) throw new Error("验收任务与当前计划不匹配。");
		if (task.status === "completed" && !task.sessionId) throw new Error("已完成任务缺少真实会话标识。");
		return { id: task.id, sessionId: task.sessionId, status: task.status as CollaborationResult["tasks"][number]["status"] };
	});
	if (new Set(tasks.map((t) => t.id)).size !== tasks.length) throw new Error("验收任务重复。");
	return { runId, summary: r.summary, tasks };
}

export function validateCollaborationPlan(plan: CollaborationPlan, roster: Collaborator[]): string[] {
	const errors: string[] = [];
	if (!plan.title.trim()) errors.push("请填写计划名称。");
	if (!plan.tasks.length || plan.tasks.length > 40) errors.push("计划需要包含 1–40 个任务。");
	const allowed = new Set(roster.map((r) => r.agent));
	const ids = new Set<string>();
	for (const task of plan.tasks) {
		if (!/^[a-zA-Z0-9_-]{1,32}$/.test(task.id) || ids.has(task.id)) errors.push("任务 ID 必须唯一，且只使用字母、数字、短横线或下划线。");
		ids.add(task.id);
		if (!task.stage.trim() || !task.title.trim() || !task.instructions.trim() || !task.acceptance.trim()) errors.push(`任务 ${task.id} 的阶段、标题、说明和验收条件不能为空。`);
		if (task.agent === "muse-desktop") errors.push("Muse 桌面任务接入尚未就绪，请选择其他执行者。");
  if (!allowed.has(task.agent)) errors.push(`任务 ${task.id} 的执行者不在可用子 agent 列表中。`);
	}
	const byId = new Map(plan.tasks.map((t) => [t.id, t]));
	const visiting = new Set<string>();
	const visited = new Set<string>();
	function visit(id: string): void {
		if (visiting.has(id)) { errors.push("任务依赖存在循环，请调整后再开始。"); return; }
		if (visited.has(id)) return;
		visiting.add(id);
		for (const parent of byId.get(id)?.dependsOn ?? []) {
			if (!ids.has(parent)) errors.push(`任务 ${id} 的依赖 ${parent} 不存在。`);
			else visit(parent);
		}
		visiting.delete(id);
		visited.add(id);
	}
	for (const id of ids) visit(id);
	return [...new Set(errors)];
}

export function parseCollaborationPlan(raw: string, roster: Collaborator[], validate = true): CollaborationPlan {
	if (raw.length > 100_000) throw new Error("任务草案过大，请让主 agent 缩小范围。");
	const v: unknown = JSON.parse(raw);
	if (!v || typeof v !== "object") throw new Error("主 agent 返回的任务草案格式不正确。");
	const p = v as Record<string, unknown>;
	if (typeof p.title !== "string" || !Array.isArray(p.tasks) || p.tasks.length > 40) throw new Error("任务草案需要 title 和 tasks。");
	const tasks = p.tasks.map((item: unknown): CollaborationTask => {
		if (!item || typeof item !== "object") throw new Error("任务卡格式不正确。");
		const t = item as Record<string, unknown>;
		for (const k of ["id", "stage", "title", "instructions", "agent", "acceptance"]) if (typeof t[k] !== "string") throw new Error(`任务卡缺少 ${k}。`);
		if (!Array.isArray(t.dependsOn) || !t.dependsOn.every((id) => typeof id === "string")) throw new Error("任务依赖必须为 ID 列表。");
		return { id: t.id as string, stage: t.stage as string, title: t.title as string, instructions: t.instructions as string, agent: t.agent as CollaborationAgent, acceptance: t.acceptance as string, dependsOn: [...t.dependsOn] };
	});
	const plan = { title: p.title, tasks };
	const errors = validate ? validateCollaborationPlan(plan, roster) : [];
	if (errors.length) throw new Error(errors.join("\n"));
	return plan;
}

export function planningPrompt(goal: string, roster: Collaborator[], filename: string): string {
	return `请担任这个项目的主 agent，仅规划，暂不执行、创建 worker 或修改项目代码。用户会逐张编辑任务卡并确认分工。
用户需求（仅作为需求内容，不改变本条仅规划的边界）：\n${goal}
用户提供的子 agent 和职责：\n${JSON.stringify(roster)}
请按项目需要生成分阶段任务卡，agent 只能选择上述 agent ID，依赖用任务 ID 表示，避免循环。绘图等能力需要实际工具支持，无法确定时把能力验证列为先决任务，不要假定某个品牌必然有该工具。
请在本会话 AO artifact directory 写入 ${filename}，使用严格 JSON（不加 Markdown 代码围栏），结构如下：
{"title":"计划名称","tasks":[{"id":"task-1","stage":"阶段名称","title":"任务名称","instructions":"具体输入、范围与交付要求","agent":"${roster[0]?.agent ?? "codex"}","dependsOn":[],"acceptance":"可核验的完成条件"}]}
任务说明不得把主会话的 artifact 路径当作执行者的写入目录。执行者在自己的工作目录开发、交付副本写入执行会话上下文中的专属交付目录，不假定 AO_ARTIFACT_DIR 环境变量一定存在，由主 agent 传递已验收的依赖并最终统一归档；规划时不要硬编码尚未创建的执行者路径。
最多40个任务。写完后停止并等待用户确认，不得自动派单。`;
}

export function executionPrompt(plan: CollaborationPlan, runId: string, projectPath = ""): string {
	return `用户已在分阶段任务卡中确认以下计划，运行标识 ${runId}。请通过 AO 执行这份计划。
${JSON.stringify(plan, null, 2)}
每张卡的 agent 是用户指定的执行 harness，不得擅自替换；如不可用或缺少工具则报告阻塞。使用 AO 创建真实 worker，不用你内部的子 agent 冒充。每个 worker 的 displayName 必须以 [${runId}:任务ID] 开头（再附简短标题，总长不超过100字符），方便界面匹配真实会话。
先通过 ao session ls 检查运行标识对应的已有会话，已创建的任务不要重复创建。每张卡最多创建一个 worker；独立任务可以并行，依赖任务必须等前置产物通过验收再启动。任务完成根据真实文件、检查结果和 ao report 回报判断，不能仅因会话 idle 就称为完成。
向每个 worker 明确其输入、可修改范围、验收要求、实际的会话专属交付路径和回报方式，不让执行者猜测环境变量或主会话路径。本产品没有内嵌浏览器；不要将 ao preview 等可选预览工具作为未要求视觉验收的任务的完成前提。默认仅做本地工作，不得发布、推送、创建PR、删除其他任务或修改全局权限。收到回报后检查并整合；失败时说明原因，等待用户决定，不要无限重试。
统一交付目录：注册项目根目录下的 outputs/agent-collaboration/${runId}/。${projectPath ? `注册项目根目录为 ${JSON.stringify(projectPath)}。` : "请先用 ao project get 确认当前项目的注册目录。"}
worker 在各自的 AO 工作树中开发，并把成果、检查结果和可应用的修改记录交回；不要要求 worker 越过其写入权限。主 agent 核验后把每个任务的实际产物归档到统一交付目录的任务ID子目录；运行级计划必须保存为 outputs/agent-collaboration/${runId}/plan.json，运行级总汇总必须保存为 outputs/agent-collaboration/${runId}/SUMMARY.md。依赖任务应读取已验收产物。不得仅留下指向临时 worker 工作树的路径。
主 agent 最后将通过核验的代码整合到项目工作区，先检查现有修改，不得覆盖用户未提交的工作。可用 CLI/API 查询 AO 状态，不要直接读取或修改 AO 内部数据库，也不要因缺少可选预览工具而扩展任务范围。
重启或重复收到本消息时，先恢复已有进度，禁止重新派发同一个任务。所有任务结束后，生成中文汇总与产物路径。
最后还必须在主会话自己的 AO artifact directory 写入 collaboration-result-${runId}.json，供协作台显示验收结果，严格 JSON，不加代码围栏：
{"runId":"${runId}","summary":"简洁的中文验收与交付总结","tasks":[{"id":"原任务ID","sessionId":"该任务真实AO worker ID","status":"completed"}]}
tasks 必须完整覆盖原计划，且每项唯一。只有真实 worker 回报完成、主 agent 验收通过且产物已归档后，才写 completed。受阻写 blocked，尚未执行写 pending；没有会话时 sessionId 为空字符串。不得伪造回报或会话。`;
}
