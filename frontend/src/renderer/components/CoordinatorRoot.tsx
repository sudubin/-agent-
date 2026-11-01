import { useState } from "react";
import { RouterProvider } from "@tanstack/react-router";
import type { createAppRouter } from "../router";
import { useUiStore } from "../stores/ui-store";
import { sessionNavigateTarget } from "../lib/navigate-to-session";
import { CoordinatorApp, CoordinatorAdvancedHeader } from "./CoordinatorApp";

/** Native chat/settings stay available for provider login, approvals and recovery. */
export function CoordinatorRoot({ router }: { router: ReturnType<typeof createAppRouter> }) {
	const [advanced, setAdvanced] = useState(false);
	return advanced ? <div className="coordinator-advanced"><CoordinatorAdvancedHeader onBack={() => { useUiStore.getState().closeSettings(); setAdvanced(false); }} /><div className="coordinator-advanced-body"><RouterProvider router={router} /></div></div> : <CoordinatorApp
		openSession={(projectId, sessionId) => { setAdvanced(true); void router.navigate(sessionNavigateTarget(projectId, sessionId)); }}
		openSettings={(agent) => { useUiStore.getState().openGlobalSettings("agents", agent ? { focusAgentId: agent } : undefined); setAdvanced(true); void router.navigate({ to: "/" }); }}
	/>;
}
