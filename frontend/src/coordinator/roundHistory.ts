import { collaborationAgents, parseCollaborationPlan, type CollaborationAgent, type Collaborator } from "../renderer/lib/collaboration-plan";
import type { Draft } from "./useWorkflow";

/** Planning/request facts only. Verification and execution status remain in AO. */
export type RoundRecord = Draft & { createdAt: string; previousRunId?: string };

export class RoundHistoryError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "RoundHistoryError";
	}
}

const historyKey = (projectId: string) => `coordinator:rounds:${projectId}`;
const legacyKey = (projectId: string) => `ao:collaboration-draft:v2:${projectId}`;
const knownAgent = (value: unknown): value is CollaborationAgent => value === "claude-code" || collaborationAgents.some((agent) => agent.id === value);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const invalid = () => new RoundHistoryError("协作轮次记录格式不正确，原记录已保留，请先备份后再处理。");

function read(key: string): string | null {
	try { return localStorage.getItem(key); }
	catch (cause) { throw new RoundHistoryError("无法读取本机的协作轮次，请保持当前页面打开。", { cause }); }
}

function parse(raw: string): unknown {
	try { return JSON.parse(raw); }
	catch (cause) { throw new RoundHistoryError("协作轮次记录无法解析，原记录已保留，请先备份后再处理。", { cause }); }
}

// Keep incomplete editable plans, along with the exact retry identity and text.
// New optional fields default like the existing v2 draft loader, without
// replacing historical Claude assignments with a different provider.
function parseDraft(value: unknown): Draft {
	if (!object(value) || typeof value.goal !== "string" || !knownAgent(value.main)
		|| !Array.isArray(value.roster) || value.roster.length > 5
		|| !value.roster.every((member) => object(member) && knownAgent(member.agent) && typeof member.responsibility === "string")
		|| !["draft", "submitted", "uncertain"].includes(String(value.state))
		|| typeof value.createMain !== "boolean" || typeof value.switchMain !== "boolean"
		|| ![value.sessionId, value.filename, value.runId].every((field) => typeof field === "string")
		|| (value.projectPath !== undefined && typeof value.projectPath !== "string")
		|| (value.executionText !== undefined && typeof value.executionText !== "string")
		|| (value.previousRunId !== undefined && typeof value.previousRunId !== "string")) throw invalid();
	const roster = value.roster.map((member) => ({ agent: member.agent, responsibility: member.responsibility })) as Collaborator[];
	let plan: Draft["plan"] = null;
	if (value.plan !== null) {
		try {
			plan = parseCollaborationPlan(JSON.stringify(value.plan), roster, false);
			if (plan.tasks.some((task) => !knownAgent(task.agent))) throw invalid();
		} catch (cause) { throw new RoundHistoryError("协作轮次中的任务卡无法读取，原记录已保留。", { cause }); }
	}
	return {
		goal: value.goal,
		main: value.main,
		roster,
		plan,
		sessionId: value.sessionId as string,
		filename: value.filename as string,
		runId: value.runId as string,
		createMain: value.createMain,
		switchMain: value.switchMain,
		projectPath: value.projectPath as string | undefined ?? "",
		executionText: value.executionText as string | undefined ?? "",
		state: value.state as Draft["state"],
		...(value.previousRunId !== undefined ? { previousRunId: value.previousRunId as string } : {}),
	};
}

function parseRecord(value: unknown): RoundRecord {
	const draft = parseDraft(value);
	if (!object(value) || !draft.runId.trim() || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) throw invalid();
	return { ...draft, createdAt: value.createdAt };
}

/** Returns oldest-first. Reading never overwrites or repairs stored data. */
export function loadRounds(projectId: string): RoundRecord[] {
	const raw = read(historyKey(projectId));
	if (raw === null) {
		const legacy = read(legacyKey(projectId));
		if (legacy === null) return [];
		const draft = parseDraft(parse(legacy));
		return draft.runId.trim() ? [{ ...draft, createdAt: new Date().toISOString() }] : [];
	}
	const value = parse(raw);
	// Accept an early unversioned array without rewriting it during a read.
	const records = Array.isArray(value) ? value : object(value) && value.version === 1 && Array.isArray(value.rounds) ? value.rounds : null;
	if (!records) throw invalid();
	const rounds = records.map(parseRecord);
	if (new Set(rounds.map((round) => round.runId)).size !== rounds.length) throw invalid();
	return rounds;
}

/** A single atomic replacement; storage failures leave the old history intact. */
export function saveRound(projectId: string, snapshot: Draft | RoundRecord): RoundRecord[] {
	const rounds = loadRounds(projectId);
	const draft = parseDraft(snapshot);
	if (!draft.runId.trim()) return rounds;
	const existing = rounds.find((round) => round.runId === draft.runId);
	const suppliedDate = "createdAt" in snapshot ? snapshot.createdAt : undefined;
	if (suppliedDate !== undefined && (typeof suppliedDate !== "string" || !Number.isFinite(Date.parse(suppliedDate)))) throw invalid();
	const record: RoundRecord = { ...draft, createdAt: existing?.createdAt ?? suppliedDate ?? new Date().toISOString() };
	const next = existing ? rounds.map((round) => round.runId === record.runId ? record : round) : [...rounds, record];
	try { localStorage.setItem(historyKey(projectId), JSON.stringify({ version: 1, rounds: next })); }
	catch (cause) { throw new RoundHistoryError("协作轮次未能保存到本机，原记录已保留，请保持此页面打开。", { cause }); }
	return next;
}

/** Restore all dispatch/retry fields without saving a derived display state. */
export function roundDraft(record: RoundRecord): Draft {
	return parseDraft(record);
}
