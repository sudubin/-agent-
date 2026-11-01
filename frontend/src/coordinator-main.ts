import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, protocol, shell } from "electron";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, openSync, closeSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { coordinatorProfile } from "./main/coordinator-profile";
import { collaborationFolder } from "./main/coordinator-folder";
import { clientApps, clientStatus, nativeConversationUrl } from "./main/coordinator-clients";
import type { EngineStatus } from "./coordinator/bridge";

declare const COORDINATOR_WINDOW_VITE_DEV_SERVER_URL: string;
const profile = coordinatorProfile(os.homedir(), app.isPackaged, process.env.AO_COORDINATOR_HOME);
const port = Number(process.env.AO_COORDINATOR_PORT || profile.port);
const base = `http://127.0.0.1:${port}`;
const resources = app.isPackaged ? process.resourcesPath : app.getAppPath();
const engine = path.join(resources, "daemon", "ao");
const exec = promisify(execFile);
let window: BrowserWindow | null = null;
let status: EngineStatus = { state: "starting" };
let quitting = false;
app.setName("协作台");
mkdirSync(profile.root, { recursive: true, mode: 0o700 });
mkdirSync(path.join(profile.root,"tools/npm"), { recursive: true, mode: 0o700 });
app.setPath("userData", profile.electron);
app.setAboutPanelOptions({ applicationName: "协作台", applicationVersion: "0.5.0", copyright: "协作执行引擎基于 Apache-2.0 许可的 Agent Orchestrator" });
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
if (!app.requestSingleInstanceLock()) app.exit(0);

function broadcast(next: EngineStatus) { status = next; window?.webContents.send("coordinator:status", next); }
async function probe(): Promise<boolean> {
	try {
		const response = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(1200) });
		if (!response.ok) return false;
		const health = await response.json() as { executablePath?: string };
		if (!health.executablePath || path.resolve(health.executablePath) !== path.resolve(engine)) throw new Error("本地端口被另一个协作服务占用。");
		return true;
	} catch (error) { if (error instanceof Error && error.message.includes("占用")) throw error; return false; }
}
async function startEngine() {
	try {
		if (await probe()) { broadcast({ state: "ready", port }); return; }
		mkdirSync(path.join(profile.root, "logs"), { recursive: true, mode: 0o700 });
		const log = openSync(path.join(profile.root, "logs", "engine.log"), "a", 0o600);
		const child = spawn(engine, ["daemon"], {
			detached: true, stdio: ["ignore", log, log], cwd: profile.root,
			env: { ...process.env,
				PATH: [path.join(resources, "daemon"), path.join(profile.root,"tools/npm/bin"), path.join(os.homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", process.env.PATH || "/usr/bin:/bin"].join(path.delimiter),
				NPM_CONFIG_PREFIX: path.join(profile.root,"tools/npm"), NPM_CONFIG_CACHE: path.join(profile.root,"tools/npm-cache"),
 AO_DATA_DIR: profile.data, AO_RUN_FILE: profile.runFile, AO_PORT: String(port), AO_OWNER: "persistent",
				LANG: process.env.LANG || "en_US.UTF-8", LC_CTYPE: process.env.LC_CTYPE || "en_US.UTF-8", PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8",
				AO_COORDINATOR_PROFILE: "1",
 AO_AGY_ACP_SERVER_PATH: path.join(resources, app.isPackaged ? "agy-acp/agy_acp_server.par" : "resources/agy-acp/agy_acp_server.par"), AO_APP_RUN_ID: `coordinator-${process.pid}`,
				AO_ACP_RUNTIME_DIR: path.join(resources, app.isPackaged ? "acp-runtime" : "resources/acp-runtime"),
				AO_TMUX_BINARY: path.join(resources, "tmux/bin/tmux"),
				AO_TELEMETRY_EVENTS: "off", AO_TELEMETRY_REMOTE: "off", AO_TELEMETRY_RENDERER: "off", AO_TELEMETRY_SENTRY: "off",
				...(!app.isPackaged && typeof COORDINATOR_WINDOW_VITE_DEV_SERVER_URL !== "undefined" ? { AO_ALLOWED_ORIGINS: new URL(COORDINATOR_WINDOW_VITE_DEV_SERVER_URL).origin } : {}),
			},
		});
		closeSync(log);
		child.on("error", (error) => broadcast({ state: "error", message: `本地协作引擎启动失败：${error.message}` }));
		child.unref();
		for (let i = 0; i < 80; i++) {
			if (await probe()) { broadcast({ state: "ready", port }); return; }
			await new Promise((resolve) => setTimeout(resolve, 350));
		}
		throw new Error("本地协作服务启动超时，请重新打开应用。");
	} catch (error) { broadcast({ state: "error", message: error instanceof Error ? error.message : String(error) }); }
}
function trusted(event: Electron.IpcMainInvokeEvent) {
	if (!window || event.sender !== window.webContents) throw new Error("不受信任的窗口请求。");
}
ipcMain.handle("coordinator:status", (event) => { trusted(event); return status; });
ipcMain.handle("coordinator:chooseDirectory", async (event, input?: string | { title?: string; defaultPath?: string }) => {
	trusted(event);
	const selected = await dialog.showOpenDialog(window!, { title: typeof input === "object" ? input.title : "选择共享项目", properties: ["openDirectory", "createDirectory"] });
	return selected.canceled ? null : selected.filePaths[0] ?? null;
});
ipcMain.handle("coordinator:getBranch", async (event, folder: unknown) => {
	trusted(event); if (typeof folder !== "string" || !path.isAbsolute(folder)) return undefined;
	try { return (await exec("/usr/bin/git", ["-C", folder, "branch", "--show-current"], { timeout: 3000 })).stdout.trim() || undefined; } catch { return undefined; }
});
ipcMain.handle("coordinator:openFolder", async (event, input: { projectId?: unknown; runId?: unknown }) => {
	trusted(event);
	if (!input || typeof input.projectId !== "string" || !input.projectId || input.projectId.length > 200 || (input.runId !== undefined && typeof input.runId !== "string")) throw new Error("项目参数不正确。");
	const response = await fetch(`${base}/api/v1/projects/${encodeURIComponent(input.projectId)}`, { signal: AbortSignal.timeout(5000) });
	if (!response.ok) throw new Error("无法读取项目。");
	const data = await response.json() as { project?: { path?: string } };
	if (typeof data.project?.path !== "string") throw new Error("项目目录不可用。");
	const target = collaborationFolder(data.project.path, input.runId as string | undefined);
	if (!(await stat(target).catch(() => null))?.isDirectory()) throw new Error("交付目录尚未生成，请稍后再查看。");
	const error = await shell.openPath(target); if (error) throw new Error(error);
});
ipcMain.handle("coordinator:clientStatus", (event, harness: unknown) => { trusted(event); if(typeof harness !== "string") throw new Error("客户端参数不正确。"); return clientStatus(harness); });
ipcMain.handle("coordinator:openClient", async (event,harness:unknown)=>{
 trusted(event); if(typeof harness !== "string" || !Object.hasOwn(clientApps,harness) || !clientStatus(harness).installed) throw new Error("未找到桌面客户端。");
 const error = await shell.openPath(clientApps[harness].path); if(error) throw new Error(error);
});
ipcMain.handle("coordinator:openNativeSession", async (event,sessionId:unknown)=>{
 trusted(event); if(typeof sessionId !== "string" || !sessionId || sessionId.length>200) throw new Error("会话参数不正确。");
 const response = await fetch(`${base}/api/v1/sessions/${encodeURIComponent(sessionId)}/conversation/native-client`,{signal:AbortSignal.timeout(5000)});
 if(!response.ok) throw new Error("无法读取原生会话。");
 const info = await response.json() as {harness:string; nativeId:string; external:boolean; supported:boolean};
 if(!info.external || !info.supported) throw new Error("请先暂停调度并移交此会话。");
 if(!clientStatus(info.harness).installed) throw new Error("未找到对应桌面客户端。");
 await shell.openExternal(nativeConversationUrl(info.harness,info.nativeId));
});
ipcMain.handle("coordinator:openExternal", async (event, raw: unknown) => {
	trusted(event); if (typeof raw !== "string") throw new Error("链接不正确。");
	const url = new URL(raw); if (!["https:", "http:"].includes(url.protocol)) throw new Error("仅支持网页链接。");
	await shell.openExternal(url.toString());
});

app.on("second-instance", () => { window?.show(); window?.focus(); });
app.on("activate", () => { window?.show(); window?.focus(); });
app.on("before-quit", () => { quitting = true; });
app.whenReady().then(async () => {
	if (app.isPackaged) {
		const renderer = path.resolve(__dirname, "../renderer/coordinator_window");
		protocol.handle("app", (request) => {
			const url = new URL(request.url);
			if (url.host !== "renderer") return new Response("Not found", { status: 404 });
			const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "coordinator.html";
			const target = path.resolve(renderer, relative);
			if (!target.startsWith(renderer + path.sep)) return new Response("Not found", { status: 404 });
			return net.fetch(pathToFileURL(target).toString());
		});
	}
	window = new BrowserWindow({ width: 1240, height: 840, minWidth: 760, minHeight: 640, title: "协作台", titleBarStyle: "hiddenInset", backgroundColor: "#f6f7fb", webPreferences: { preload: path.join(__dirname, "coordinator-preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true } });
	window.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) void shell.openExternal(url); return { action: "deny" }; });
	window.webContents.on("will-navigate", (event, url) => { if (!url.startsWith("app://renderer/") && !(typeof COORDINATOR_WINDOW_VITE_DEV_SERVER_URL !== "undefined" && url.startsWith(COORDINATOR_WINDOW_VITE_DEV_SERVER_URL))) event.preventDefault(); });
	window.on("close", (event) => { if (!quitting) { event.preventDefault(); window?.hide(); } });
	const icon = path.join(resources, app.isPackaged ? "coordinator/coordinator.png" : "assets/coordinator/coordinator.png");
	if (existsSync(icon)) app.dock?.setIcon(nativeImage.createFromPath(icon));
	Menu.setApplicationMenu(Menu.buildFromTemplate([
		{ label: "协作台", submenu: [{ role: "about" }, { label: "返回协作台首页", accelerator: "CmdOrCtrl+Shift+H", click: () => { window?.show(); window?.webContents.send("coordinator:home"); } }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { type: "separator" }, { label: "退出协作台（任务继续）", accelerator: "CmdOrCtrl+Q", role: "quit" }] },
		{ label: "编辑", role: "editMenu" }, { label: "视图", submenu: [{ role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "togglefullscreen" }] }, { label: "窗口", role: "windowMenu" },
	]));
	if (typeof COORDINATOR_WINDOW_VITE_DEV_SERVER_URL !== "undefined" && COORDINATOR_WINDOW_VITE_DEV_SERVER_URL) await window.loadURL(`${COORDINATOR_WINDOW_VITE_DEV_SERVER_URL}/coordinator.html`);
	else await window.loadURL("app://renderer/coordinator.html");
	void startEngine();
});
