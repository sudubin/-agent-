import type { EngineStatus } from "./bridge";
export function DaemonFailureBanner({ status }: { status: EngineStatus }) {
	return status.state === "error" ? <div role="alert" className="coordinator-alert">{status.message || "本地协作服务未能启动。请重新打开协作台。"}</div> : null;
}
