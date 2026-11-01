import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadRounds, RoundHistoryError, roundDraft, saveRound, type RoundRecord } from "./roundHistory";
import type { Draft } from "./useWorkflow";

const key = "coordinator:rounds:project";
const legacyKey = "ao:collaboration-draft:v2:project";
const draft = (overrides: Partial<Draft> = {}): Draft => ({
	goal: "制作页面", main: "codex", roster: [{ agent: "codex", responsibility: "实现" }],
	plan: { title: "第一轮", tasks: [{ id: "task-1", stage: "实现", title: "页面", instructions: "完成页面", acceptance: "可打开", agent: "codex", dependsOn: [] }] },
	sessionId: "same-main", filename: "collaboration-plan-first.json", runId: "first", createMain: false, switchMain: false,
	projectPath: "/project", executionText: "exact confirmed instructions", state: "submitted", ...overrides,
});
const record = (overrides: Partial<RoundRecord> = {}): RoundRecord => ({ ...draft(), createdAt: "2026-11-01T01:00:00.000Z", ...overrides });

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("project collaboration round history", () => {
	it("keeps all rounds and their own plans while reusing the main conversation", () => {
		saveRound("project", record());
		saveRound("project", draft({ runId: "second", goal: "完善下一版", filename: "next-plan.json", plan: { title: "第二轮", tasks: [] }, previousRunId: "first", state: "draft" }));
		const rounds = loadRounds("project");
		expect(rounds.map((round) => round.runId)).toEqual(["first", "second"]);
		expect(rounds.map((round) => round.sessionId)).toEqual(["same-main", "same-main"]);
		expect(rounds[0].plan?.title).toBe("第一轮");
		expect(rounds[1].previousRunId).toBe("first");
		expect(roundDraft(rounds[0])).toEqual(draft());
		expect(roundDraft(rounds[0])).not.toHaveProperty("createdAt");
	});

	it("updates one round without duplicating it or losing its original creation time", () => {
		saveRound("project", record({ state: "uncertain" }));
		saveRound("project", record({ runId: "second", createdAt: "2026-11-01T02:00:00.000Z" }));
		const saved = saveRound("project", record({ createdAt: "2026-11-02T03:00:00.000Z", state: "submitted", executionText: "original retry message", filename: "identity.json" }));
		expect(saved.map((round) => round.runId)).toEqual(["first", "second"]);
		expect(saved[0]).toMatchObject({ createdAt: "2026-11-01T01:00:00.000Z", executionText: "original retry message", filename: "identity.json", state: "submitted" });
	});

	it("imports an existing v2 draft read-only, retaining its old provider and retry identity", () => {
		const legacy = draft({ main: "claude-code", roster: [{ agent: "claude-code", responsibility: "历史工作" }], state: "uncertain" });
		const raw = JSON.stringify(legacy); localStorage.setItem(legacyKey, raw);
		const rounds = loadRounds("project");
		expect(rounds).toHaveLength(1); expect(rounds[0]).toMatchObject(legacy);
		expect(localStorage.getItem(key)).toBeNull(); expect(localStorage.getItem(legacyKey)).toBe(raw);
		saveRound("project", draft({ runId: "second" }));
		expect(loadRounds("project").map((round) => round.runId)).toEqual(["first", "second"]);
		expect(localStorage.getItem(legacyKey)).toBe(raw);
	});

	it("defaults optional fields in older drafts without inventing an execution result", () => {
		const legacy = { ...draft(), projectPath: undefined, executionText: undefined };
		localStorage.setItem(legacyKey, JSON.stringify(legacy));
		expect(loadRounds("project")[0]).toMatchObject({ projectPath: "", executionText: "", state: "submitted" });
		expect(loadRounds("project")[0]).not.toHaveProperty("completed");
	});

	it("does not store an empty planning shell or modify another project's history", () => {
		expect(loadRounds("project")).toEqual([]);
		expect(saveRound("project", draft({ runId: "", plan: null }))).toEqual([]);
		expect(localStorage.getItem(key)).toBeNull();
		saveRound("other", record()); expect(loadRounds("project")).toEqual([]);
	});

	it("accepts an old array representation without rewriting it on read", () => {
		const raw = JSON.stringify([record()]); localStorage.setItem(key, raw);
		expect(loadRounds("project")).toEqual([record()]); expect(localStorage.getItem(key)).toBe(raw);
	});

	it.each(["{broken", JSON.stringify({ version: 2, rounds: [] }), JSON.stringify({ version: 1, rounds: [null] }), JSON.stringify({ version: 1, rounds: [record(), record()] }), JSON.stringify({ version: 1, rounds: [record({ createdAt: "unknown" })] })])("refuses to overwrite unreadable history (%s)", (raw) => {
		localStorage.setItem(key, raw);
		expect(() => loadRounds("project")).toThrow(RoundHistoryError);
		expect(() => saveRound("project", draft({ runId: "new" }))).toThrow(RoundHistoryError);
		expect(localStorage.getItem(key)).toBe(raw);
	});

	it("retains malformed legacy data instead of silently replacing it", () => {
		const raw = JSON.stringify({ ...draft(), roster: [null] }); localStorage.setItem(legacyKey, raw);
		expect(() => saveRound("project", draft({ runId: "new" }))).toThrow(RoundHistoryError);
		expect(localStorage.getItem(key)).toBeNull(); expect(localStorage.getItem(legacyKey)).toBe(raw);
	});

	it("reports storage read and write failures and leaves existing records intact", () => {
		saveRound("project", record()); const original = localStorage.getItem(key);
		const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError"); });
		expect(() => saveRound("project", draft({ runId: "second" }))).toThrow(/未能保存/);
		write.mockRestore(); expect(localStorage.getItem(key)).toBe(original);
		vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new DOMException("denied", "SecurityError"); });
		expect(() => loadRounds("project")).toThrow(/无法读取/);
	});

	it("stores independent snapshots and omits derived status fields", () => {
		const incoming = { ...draft(), completed: true, workerStatus: "done" }; saveRound("project", incoming);
		incoming.plan!.title = "later unsaved change";
		expect(loadRounds("project")[0].plan?.title).toBe("第一轮");
		expect(localStorage.getItem(key)).not.toContain("completed"); expect(localStorage.getItem(key)).not.toContain("workerStatus");
	});
});
