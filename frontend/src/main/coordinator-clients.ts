import { existsSync } from "node:fs";

export const clientApps: Record<string, { path: string; label: string }> = {
 codex: {path: "/Applications/ChatGPT.app", label:"Codex"},
 "deepseek-harness": {path:"/Applications/DeepSeek Harness.app",label:"DeepSeek Harness"},
 copilot: {path:"/Applications/GitHub Copilot.app",label:"GitHub Copilot"},
 agy: {path:"/Applications/Antigravity.app",label:"AGY"},
 "muse-desktop": {path:"/Applications/Muse.app",label:"Muse"},
};
export function clientStatus(harness: string) {
 const client = Object.hasOwn(clientApps,harness) ? clientApps[harness] : undefined;
 return { installed: Boolean(client && existsSync(client.path)), label: client?.label || harness };
}
// These are the installed clients' actual existing-conversation routes. DSH
// supports app focus only; it must never be described as selecting a session.
export function nativeConversationUrl(harness: string, id: string): string {
 if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new Error("原生会话标识不正确。");
 switch(harness) {
  case "codex": return `codex://threads/${id}`;
  case "copilot": return `ghapp://sessions/${id}`;
  case "deepseek-harness": return "dsh://open";
  default: throw new Error("此客户端尚未接通同会话入口。");
 }
}
