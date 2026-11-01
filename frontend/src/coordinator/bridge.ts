export type EngineStatus = { state: "starting" | "ready" | "error"; port?: number; message?: string };
export type CoordinatorBridge = {
	status: () => Promise<EngineStatus>;
 clientStatus: (harness: string) => Promise<{installed: boolean; label: string}>;
 openClient: (harness: string) => Promise<void>;
 openNativeSession: (sessionId: string) => Promise<void>;
	onStatus: (listener: (status: EngineStatus) => void) => () => void;
	onHome: (listener: () => void) => () => void;
	chooseDirectory: (input?: string | { title?: string; defaultPath?: string }) => Promise<string | null>;
	getBranch: (folder: string) => Promise<string | undefined>;
	openFolder: (input: { projectId: string; runId?: string }) => Promise<void>;
	openExternal: (url: string) => Promise<void>;
};
declare global { interface Window { coordinator: CoordinatorBridge } }
export const native = window.coordinator;
// Small compatibility shape for our existing planning UI, not the AO desktop bridge.
export const aoBridge = { app: { chooseDirectory: native.chooseDirectory, getRepositoryBranch: native.getBranch, openCollaborationFolder: native.openFolder } };
