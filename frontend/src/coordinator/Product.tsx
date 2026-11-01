import { useEffect, useState } from "react";
import { CoordinatorApp } from "./App";
import { ConversationPanel, SettingsPanel } from "./Panels";
import { native } from "./bridge";

export function Product() {
	const [panel, setPanel] = useState<{ type: "settings"; agent?: string } | { type: "session"; sessionId: string } | null>(null);
	useEffect(() => native.onHome(() => setPanel(null)), []);
	return <><div inert={panel !== null}><CoordinatorApp openSession={(_projectId, sessionId) => setPanel({ type: "session", sessionId })} openSettings={(agent) => setPanel({ type: "settings", agent })} /></div>{panel?.type === "settings" && <SettingsPanel focusAgent={panel.agent} onClose={() => setPanel(null)} />}{panel?.type === "session" && <ConversationPanel sessionId={panel.sessionId} onClose={() => setPanel(null)} />}</>;
}
