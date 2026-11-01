import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProjectOrchestratorAction } from "../hooks/useProjectOrchestratorAction";
import { ProjectBoardActions } from "./ProjectBoardActions";
import { TooltipProvider } from "./ui/tooltip";

const actions: ProjectOrchestratorAction = {
	projectId: undefined,
	orchestrator: undefined,
	isSpawning: false,
	isProjectRestarting: false,
	isProvisioning: false,
	spawnError: "",
	canCreateAsTui: false,
	openNewTask: vi.fn(),
	openOrchestrator: vi.fn(),
};

describe("ProjectBoardActions", () => {
	it("exposes collaboration planning only on enabled local project boards", () => {
		const projectActions = { ...actions, projectId: "local-project" };
		const { rerender } = render(<TooltipProvider><ProjectBoardActions actions={projectActions} placement="header" collaboration /></TooltipProvider>);
		expect(screen.getByRole("button", { name: "协作规划" })).toBeInTheDocument();
		rerender(<TooltipProvider><ProjectBoardActions actions={projectActions} placement="header" collaboration cloud /></TooltipProvider>);
		expect(screen.queryByRole("button", { name: "协作规划" })).not.toBeInTheDocument();
		rerender(<TooltipProvider><ProjectBoardActions actions={projectActions} placement="header" /></TooltipProvider>);
		expect(screen.queryByRole("button", { name: "协作规划" })).not.toBeInTheDocument();
	});
	it("keeps the cloud Task plain without changing the Orchestrator button", () => {
		render(
			<TooltipProvider>
				<ProjectBoardActions actions={actions} cloud placement="header" />
			</TooltipProvider>,
		);
		expect(screen.getByRole("button", { name: "New task" })).toHaveClass("topbar-control--secondary");
		expect(screen.getByRole("button", { name: /orchestrator/i })).toHaveClass("topbar-control--primary", "bg-accent-strong");
	});

	it("preserves the existing empty local board controls", () => {
		render(
			<TooltipProvider>
				<ProjectBoardActions actions={actions} placement="header" quiet />
			</TooltipProvider>,
		);
		expect(screen.getByRole("button", { name: "New task" })).toHaveClass("topbar-control--secondary");
		expect(screen.getByRole("button", { name: /orchestrator/i })).toHaveClass("topbar-control--secondary");
	});
});
