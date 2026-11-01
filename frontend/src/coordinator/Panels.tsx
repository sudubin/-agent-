import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { ArrowLeft, RefreshCw, Send, X } from "lucide-react";
import { apiClient, apiErrorMessage, getApiBaseUrl } from "./api";
import { native } from "./bridge";
import { cacheAgentReadiness, ensureAgentReadiness, useAgentReadinessQuery } from "./data";
import { ExecutionTimeline } from "./ExecutionTimeline";
import { NativeClientPanel } from "./NativeClientPanel";
import { collaborationAgents, dispatchableAgents } from "../renderer/lib/collaboration-plan";
import { createTerminalMux, muxUrlFromApiBase } from "./terminalMux";
import type { components } from "../api/schema";
import "@xterm/xterm/css/xterm.css";

type Activity = components["schemas"]["ConversationActivityResponse"];
type Auth = components["schemas"]["StartAgentAuthResponse"];

export function SettingsPanel({ onClose, focusAgent }: { onClose: () => void; focusAgent?: string }) {
	const readiness = useAgentReadinessQuery();
	const client = useQueryClient();
	const [error, setError] = useState("");
	const [busy, setBusy] = useState("");
	const [auth, setAuth] = useState<Auth | null>(null);
	async function refresh() { setError(""); setBusy("refresh"); try { cacheAgentReadiness(client, await ensureAgentReadiness(dispatchableAgents.map((a) => a.id), "launch")); } catch (e) { setError(String(e)); } finally { setBusy(""); } }
	async function login(id: string) {
		setBusy(id); setError("");
		try { const { data, error } = await apiClient.POST("/api/v1/agents/{agent}/auth", { params: { path: { agent: id } } }); if (error || !data) throw new Error(apiErrorMessage(error)); setAuth(data); }
		catch (e) { setError(e instanceof Error ? e.message : String(e)); }
		finally { setBusy(""); }
	}
	async function install(id: string) {
		setBusy(id); setError("");
		try { const { data, error } = await apiClient.POST("/api/v1/agents/{agent}/install", { params: { path: { agent: id } }, body: { operation: "install" } }); if (error) throw new Error(apiErrorMessage(error)); if (data?.status === "unsupported" || data?.status === "failed") throw new Error(data.error || "当前无法安装，请检查连接。"); setError("已开始安装。完成后点击“刷新状态”检查。"); }
		catch (e) { setError(e instanceof Error ? e.message : String(e)); }
		finally { setBusy(""); }
	}
	return <div className="co-panel-backdrop"><section role="dialog" aria-modal="true" aria-label="Agent 设置" className="co-panel">
		<header className="co-panel-header"><button className="coordinator-text-button" onClick={onClose}><ArrowLeft size={16} />返回项目</button><h2>Agent 设置</h2><button className="coordinator-icon-button" aria-label="关闭 Agent 设置" onClick={onClose}><X size={18} /></button></header>
		<div className="co-panel-body"><p className="co-panel-intro">只连接你实际要用的 agent。账户登录由各自的官方客户端处理。</p>
			{collaborationAgents.map((agent) => { if(agent.id === "muse-desktop") return <div className="co-agent-card" key={agent.id}><div><strong>Muse 桌面</strong><p>已安装的 Meta Muse；自动任务接入尚待完成，暂不能派单。</p></div><button className="coordinator-secondary" onClick={()=>void native.openClient("muse-desktop").catch((e)=>setError(String(e)))}>打开 Muse</button></div>; const ready = readiness.data?.agents.find((r) => r.id === agent.id); const installed = ready?.installation.state === "installed"; return <div className={`co-agent-card ${focusAgent === agent.id ? "focused" : ""}`} key={agent.id}><div><strong>{agent.label}</strong><p>{ready?.effectiveReadiness === "ready" ? "已就绪，可以参与协作" : installed ? "已安装，需要登录或检查账户" : ready ? "尚未准备好" : "正在检测…"}</p></div><div className="coordinator-button-row">{!installed && ready && <button className="coordinator-secondary" disabled={Boolean(busy)} onClick={() => void install(agent.id)}>安装</button>}<button className="coordinator-secondary" disabled={Boolean(busy) || !installed} onClick={() => void login(agent.id)}>{busy === agent.id ? "正在打开…" : ready?.effectiveReadiness === "ready" ? "账户登录" : "登录"}</button></div></div>; })}
			<button className="coordinator-secondary" disabled={Boolean(busy)} onClick={() => void refresh()}><RefreshCw size={14} />{busy === "refresh" ? "正在检测…" : "刷新状态"}</button>
			{error && <p role="alert" className="coordinator-alert">{error}</p>}
			{auth && <div className="co-auth"><div className="co-auth-heading"><strong>{collaborationAgents.find((a) => a.id === auth.agentId)?.label} 登录</strong><button className="coordinator-text-button" onClick={() => { void apiClient.DELETE("/api/v1/shell-terminals/{handleId}", { params: { path: { handleId: auth.terminal.handleId } } }); setAuth(null); void refresh(); }}>结束登录</button></div><p>在下方完成官方登录。登录成功后，点击上面的“刷新状态”。</p><AuthTerminal key={auth.terminal.handleId} auth={auth} onExit={() => void refresh()} /></div>}
		</div>
	</section></div>;
}

function AuthTerminal({ auth, onExit }: { auth: Auth; onExit: () => void }) {
	const host = useRef<HTMLDivElement>(null);
	const mux = useRef<ReturnType<typeof createTerminalMux> | null>(null);
	const [attached, setAttached] = useState(false);
	useEffect(() => {
		if (!host.current) return;
		const term = new Terminal({ fontSize: 12, fontFamily: "Menlo, monospace", cursorBlink: true, theme: { background: "#162033", foreground: "#d8e4fa" }, allowProposedApi: true });
		const fit = new FitAddon(); term.loadAddon(fit); term.loadAddon(new WebLinksAddon((_event, uri) => void native.openExternal(uri))); term.open(host.current); fit.fit();
		const connection = createTerminalMux(muxUrlFromApiBase(getApiBaseUrl())); mux.current = connection;
		const offData = connection.onData(auth.terminal.handleId, (bytes) => term.write(bytes));
		const offOpen = connection.onOpened(auth.terminal.handleId, () => setAttached(true));
		const offExit = connection.onExit(auth.terminal.handleId, () => { setAttached(false); onExit(); });
		const offError = connection.onError(auth.terminal.handleId, (message) => term.writeln(`\r\n${message}`));
		connection.open(auth.terminal.handleId, term.cols, term.rows);
		const input = term.onData((text) => connection.sendInput(auth.terminal.handleId, text));
		const resize = new ResizeObserver(() => { fit.fit(); connection.resize(auth.terminal.handleId, term.cols, term.rows); }); resize.observe(host.current);
		return () => { resize.disconnect(); input.dispose(); offData(); offOpen(); offExit(); offError(); connection.dispose(); term.dispose(); mux.current = null; };
	}, [auth.terminal.handleId]);
	return <>{auth.terminalInput && <button className="coordinator-secondary" disabled={!attached} onClick={() => mux.current?.sendInput(auth.terminal.handleId, auth.terminalInput!)}>开始登录</button>}<div className="co-auth-terminal" ref={host} /></>;
}

export function ConversationPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
	const client = useQueryClient();
	const key = ["coordinator", "conversation", sessionId];
	const conversation = useQuery({ queryKey: key, refetchInterval: 1500, queryFn: async () => { const { data, error } = await apiClient.GET("/api/v1/sessions/{sessionId}/conversation", { params: { path: { sessionId }, query: { limit: 35 } } }); if (error || !data) throw new Error(apiErrorMessage(error)); return data; } });
	const [text, setText] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
 const [external,setExternal] = useState(false);
	const request = useRef<{ text: string; clientMessageId: string } | null>(null);
	async function send() {
		if (external || busy || !text.trim()) return;
		setBusy(true); setError(""); request.current ??= { text, clientMessageId: `chat-${crypto.randomUUID()}` };
		try { const { error } = await apiClient.POST("/api/v1/sessions/{sessionId}/conversation/messages", { params: { path: { sessionId } }, body: request.current }); if (error) throw new Error(apiErrorMessage(error)); request.current = null; setText(""); await client.invalidateQueries({ queryKey: key }); }
		catch (e) { setError(e instanceof Error ? e.message : String(e)); }
		finally { setBusy(false); }
	}
	const pending = conversation.data?.activities.filter((a) => a.status === "pending" && ["approval", "user_input"].includes(a.activityKind)) ?? [];
	const messages = conversation.data?.messages ?? [];
	return <div className="co-panel-backdrop"><section role="dialog" aria-modal="true" aria-label="运行会话" className="co-panel co-conversation"><header className="co-panel-header"><button className="coordinator-text-button" onClick={onClose}><ArrowLeft size={16} />返回项目</button><h2>沟通与运行记录</h2><button className="coordinator-icon-button" aria-label="关闭会话" onClick={onClose}><X size={18} /></button></header><div className="co-panel-body co-messages">
		<NativeClientPanel sessionId={sessionId} onOwnership={setExternal} />
  {conversation.error && <p role="alert" className="coordinator-alert">{conversation.error.message}</p>}
		{pending.map((activity) => <RequestCard key={activity.id} activity={activity} sessionId={sessionId} onResolved={() => { void client.invalidateQueries({ queryKey: key }); }} />)}
		<ExecutionTimeline feed={conversation.data} skipPendingRequests />
		{!messages.length && !conversation.isLoading && <p className="co-panel-intro">这里会显示真实的执行记录、提问和审批。</p>}
		</div><div className="co-composer">{error && <p role="alert" className="coordinator-alert">{error}</p>}<textarea aria-label="给 agent 的消息" rows={3} placeholder="补充要求，或询问当前进度…" value={text} disabled={external || busy || Boolean(request.current)} onChange={(e) => setText(e.target.value)} /><button className="coordinator-primary" disabled={external || busy || !text.trim()} onClick={() => void send()}><Send size={14} />{busy ? "发送中…" : request.current ? "重试原消息" : "发送"}</button></div></section></div>;
}

export function RequestCard({ activity, sessionId, onResolved }: { activity: Activity; sessionId: string; onResolved: () => void }) {
	const [answers, setAnswers] = useState<Record<string, unknown>>(() => {
  const properties = (activity.detail?.schema as { properties?: Record<string, { type?: string }> } | undefined)?.properties ?? {};
  return Object.fromEntries(Object.entries(properties).filter(([, field]) => field.type === "boolean").map(([name]) => [name, false]));
 });
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const detail = activity.detail ?? {};
	const decisions = Array.isArray(detail.decisions) ? detail.decisions.filter((d): d is { id: string; label?: string } => Boolean(d && typeof d === "object" && typeof d.id === "string")) : [];
	const schema = detail.schema as { required?: string[]; properties?: Record<string, { title?: string; description?: string; type?: string; enum?: unknown[] }> } | undefined;
	async function resolve(decisionId?: string) {
		if (busy || activity.requestId === undefined) return;
		if (!decisionId && schema?.required?.some((name) => answers[name] === undefined || answers[name] === "")) { setError("请先填写必填项目。"); return; }
		setBusy(true); setError("");
		try {
			const params = { path: { sessionId, requestId: activity.requestId } };
			const result = decisionId !== undefined ? await apiClient.POST("/api/v1/sessions/{sessionId}/conversation/approvals/{requestId}/resolve", { params, body: { decisionId } }) : await apiClient.POST("/api/v1/sessions/{sessionId}/conversation/inputs/{requestId}/resolve", { params, body: { action: "accept", content: answers } });
			if (result.error) throw new Error(apiErrorMessage(result.error)); onResolved();
		} catch (e) { setError(e instanceof Error ? e.message : String(e)); }
		finally { setBusy(false); }
	}
	return <section className="co-request"><h3>{activity.activityKind === "approval" ? "需要你审批" : "Agent 需要你的回答"}</h3><p>{activity.summary}</p>
		{activity.activityKind === "approval" ? <><details><summary>查看请求内容</summary><pre>{JSON.stringify(detail, null, 2)}</pre></details><div className="coordinator-button-row">{decisions.map((d) => <button className="coordinator-secondary" disabled={busy} key={d.id} onClick={() => void resolve(d.id)}>{d.label || d.id}</button>)}</div></> : <>
			{typeof detail.url === "string" && <button className="coordinator-secondary" onClick={() => void native.openExternal(detail.url as string)}>打开请求中的网页</button>}
			{Object.entries(schema?.properties ?? {}).map(([name, field]) => <label className="coordinator-label" key={name}>{field.title || name}{schema?.required?.includes(name) ? " *" : ""}{field.enum ? <select value={String(answers[name] ?? "")} onChange={(e) => setAnswers((a) => ({ ...a, [name]: field.enum?.find((option) => String(option) === e.target.value) }))}><option value="">请选择</option>{field.enum.map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}</select> : field.type === "boolean" ? <input type="checkbox" checked={Boolean(answers[name])} onChange={(e) => setAnswers((a) => ({ ...a, [name]: e.target.checked }))} /> : <input type={field.type === "number" || field.type === "integer" ? "number" : "text"} value={String(answers[name] ?? "")} onChange={(e) => setAnswers((a) => ({ ...a, [name]: field.type === "number" || field.type === "integer" ? e.target.value === "" ? undefined : Number(e.target.value) : e.target.value }))} />}</label>)}
			<button className="coordinator-primary" disabled={busy} onClick={() => void resolve()}>提交回答并继续</button>
		</>}{error && <p role="alert" className="coordinator-alert">{error}</p>}
	</section>;
}
