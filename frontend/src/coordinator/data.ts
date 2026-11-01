import { useEffect, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { apiClient, apiErrorMessage, setApiBaseUrl } from "./api";
import { dispatchableAgents } from "../renderer/lib/collaboration-plan";
import { native, type EngineStatus } from "./bridge";
import type { components } from "../api/schema";

export type WorkspaceSession = { id: string; title: string; kind: string; provider: string; status: string; isTerminated: boolean; activity?: { state: string } };
export type WorkspaceSummary = { id: string; name: string; path: string; kind: string; sessions: WorkspaceSession[] };
export function useDaemonStatus(_client?: QueryClient) {
	const [status, setStatus] = useState<EngineStatus>({ state: "starting" });
	const client = useQueryClient();
	useEffect(() => {
		let alive = true;
		const apply = (s: EngineStatus) => { if (!alive) return; if (s.state === "ready" && s.port) setApiBaseUrl(s.port); setStatus(s); if (s.state === "ready") void client.invalidateQueries(); };
		void native.status().then(apply);
		const stop = native.onStatus(apply);
		return () => { alive = false; stop(); };
	}, [client]);
	return status;
}
export const workspaceQueryKeyForHost = () => ["coordinator", "workspaces"] as const;
export function useWorkspaceQuery(options: { enabled?: boolean; subscribed?: boolean; includeCloud?: boolean } = {}) {
 const enabled = options.enabled ?? true;
	return useQuery({ queryKey: workspaceQueryKeyForHost(), enabled, refetchInterval: 2_500, queryFn: async (): Promise<WorkspaceSummary[]> => {
		const [p, s] = await Promise.all([apiClient.GET("/api/v1/projects"), apiClient.GET("/api/v1/sessions")]);
		if (p.error || s.error) throw new Error(apiErrorMessage(p.error || s.error));
		return (p.data?.projects ?? []).map((project) => ({ id: project.id, name: project.name === "project" ? project.path.split(/[\\/]/).filter(Boolean).at(-1) || project.name : project.name, path: project.path, kind: project.kind, sessions: (s.data?.sessions ?? []).filter((session) => session.projectId === project.id).map((session) => ({ id: session.id, title: session.displayName || session.id, kind: session.kind, provider: session.harness || "unknown", status: session.status, isTerminated: session.isTerminated, activity: session.activity })) }));
	} });
}
type Readiness = components["schemas"]["AgentReadinessResponse"];
export async function ensureAgentReadiness(agentIds: string[], purpose: "display" | "launch" = "display"): Promise<Readiness> {
	const { data, error } = await apiClient.POST("/api/v1/agents/readiness/ensure", { body: { agentIds, purpose } });
	if (error || !data) throw new Error(apiErrorMessage(error)); return data;
}
export function cacheAgentReadiness(client: QueryClient, result: Readiness) { client.setQueryData(["coordinator", "readiness"], result); }
export function useAgentReadinessQuery() {
	return useQuery({ queryKey: ["coordinator", "readiness"], queryFn: () => ensureAgentReadiness(dispatchableAgents.map((a) => a.id)), staleTime: 10_000 });
}
