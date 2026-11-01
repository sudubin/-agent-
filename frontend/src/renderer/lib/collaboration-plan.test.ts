import { describe, expect, it } from "vitest";
import { executionPrompt, parseCollaborationPlan, parseCollaborationResult, planningPrompt, validateCollaborationPlan, type CollaborationPlan, type Collaborator } from "./collaboration-plan";

const roster: Collaborator[] = [{ agent: "codex", responsibility: "绘图" }, { agent: "deepseek-harness", responsibility: "编程" }];
const plan = (): CollaborationPlan => ({ title: "网站", tasks: [
	{ id: "art", stage: "素材", title: "插图", instructions: "绘制首屏插图", acceptance: "PNG 文件存在", agent: "codex", dependsOn: [] },
	{ id: "code", stage: "实现", title: "前端", instructions: "使用插图制作页面", acceptance: "页面可打开", agent: "deepseek-harness", dependsOn: ["art"] },
] });

describe("collaboration plans", () => {
	it("requires a complete run-specific verification manifest", () => {
		const result = { runId: "run-a", summary: "验收完成", tasks: [{ id: "art", sessionId: "worker-1", status: "completed" }, { id: "code", sessionId: "worker-2", status: "completed" }] };
		expect(parseCollaborationResult(JSON.stringify(result), plan(), "run-a").tasks).toHaveLength(2);
		expect(() => parseCollaborationResult(JSON.stringify(result), plan(), "another-run")).toThrow();
		expect(() => parseCollaborationResult(JSON.stringify({ ...result, tasks: [result.tasks[0], result.tasks[0]] }), plan(), "run-a")).toThrow();
		expect(() => parseCollaborationResult(JSON.stringify({ ...result, tasks: [{ ...result.tasks[0], sessionId: "" }, result.tasks[1]] }), plan(), "run-a")).toThrow();
	});
	it("accepts valid stage cards and keeps per-card harness selections", () => {
		const result = parseCollaborationPlan(JSON.stringify(plan()), roster);
		expect(result.tasks.map((t) => t.agent)).toEqual(["codex", "deepseek-harness"]);
	});
	it("blocks dependency cycles before any execution request", () => {
		const p = plan(); p.tasks[0].dependsOn = ["code"];
		expect(validateCollaborationPlan(p, roster)).toContain("任务依赖存在循环，请调整后再开始。");
	});
	it("rejects missing dependencies, duplicate IDs and workers outside the roster", () => {
		const p = plan(); p.tasks[1].dependsOn = ["unknown"]; p.tasks[1].agent = "claude-code"; p.tasks[1].id = "art";
		expect(validateCollaborationPlan(p, roster).length).toBe(3);
	});
	it("requires useful task descriptions and acceptance conditions", () => {
		const p = plan(); p.tasks[0].acceptance = " ";
		expect(validateCollaborationPlan(p, roster)[0]).toContain("验收条件不能为空");
	});
	it("rejects malformed or excessive model output instead of displaying untrusted shapes", () => {
		expect(() => parseCollaborationPlan('{"title":"x","tasks":[{}]}', roster)).toThrow("缺少");
		expect(() => parseCollaborationPlan(JSON.stringify({ title: "x", tasks: Array(41).fill(plan().tasks[0]) }), roster)).toThrow();
	});
	it("planning asks only for a draft file, with no task execution", () => {
		const prompt = planningPrompt("制作游戏", roster, "plan-x.json");
		expect(prompt).toContain("仅规划"); expect(prompt).toContain("不得自动派单");
		expect(prompt).toContain("plan-x.json"); expect(prompt).toContain("验证");
	});
	it("execution preserves edited assignments, stable task names and dependency rules", () => {
		const p = plan(); p.tasks[0].agent = "deepseek-harness";
		const prompt = executionPrompt(p, "run-a", "/projects/示例");
		expect(prompt).toContain(JSON.stringify(p, null, 2));
		expect(prompt).toContain("[run-a:任务ID]"); expect(prompt).toContain("不得擅自替换");
		expect(prompt).toContain("依赖任务必须等前置产物通过验收"); expect(prompt).toContain("不要重复创建");
		expect(prompt).toContain("outputs/agent-collaboration/run-a/");
		expect(prompt).toContain("/projects/示例");
		expect(prompt).toContain("不得仅留下指向临时 worker 工作树的路径");
	});
});
