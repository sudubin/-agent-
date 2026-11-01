import { contextBridge, ipcRenderer } from "electron";
import type { CoordinatorBridge, EngineStatus } from "./coordinator/bridge";
const bridge: CoordinatorBridge = {
	status: () => ipcRenderer.invoke("coordinator:status"),
 clientStatus: (harness) => ipcRenderer.invoke("coordinator:clientStatus",harness),
 openClient: (harness) => ipcRenderer.invoke("coordinator:openClient",harness),
 openNativeSession: (sessionId) => ipcRenderer.invoke("coordinator:openNativeSession",sessionId),
	onStatus: (listener) => { const receive = (_event: Electron.IpcRendererEvent, status: EngineStatus) => listener(status); ipcRenderer.on("coordinator:status", receive); return () => { ipcRenderer.off("coordinator:status", receive); }; },
	onHome: (listener) => { ipcRenderer.on("coordinator:home", listener); return () => { ipcRenderer.off("coordinator:home", listener); }; },
	chooseDirectory: (input) => ipcRenderer.invoke("coordinator:chooseDirectory", input),
	getBranch: (folder) => ipcRenderer.invoke("coordinator:getBranch", folder),
	openFolder: (input) => ipcRenderer.invoke("coordinator:openFolder", input),
	openExternal: (url) => ipcRenderer.invoke("coordinator:openExternal", url),
};
contextBridge.exposeInMainWorld("coordinator", bridge);
