import path from "node:path";

export function collaborationFolder(projectRoot: string, runId?: string): string {
	if (!path.isAbsolute(projectRoot)) throw new Error("项目目录不正确。");
	if (runId === undefined) return projectRoot;
	if (!/^[a-zA-Z0-9_-]{1,64}$/.test(runId)) throw new Error("任务标识不正确。");
	return path.join(projectRoot, "outputs", "agent-collaboration", runId);
}
