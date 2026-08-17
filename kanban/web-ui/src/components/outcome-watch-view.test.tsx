import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OutcomeWatchView } from "@/components/outcome-watch-view";
import type { RuntimeAgentRun, RuntimeLedgerEvent, RuntimeOutcome } from "@/runtime/types";

vi.mock("@/components/phuong/phuong-chat-panel", () => ({
	PhuongChatPanel: () => <div>Phuong compact</div>,
}));

vi.mock("@/components/detail-panels/agent-terminal-panel", () => ({
	AgentTerminalPanel: ({ readOnly }: { readOnly?: boolean }) => (
		<div>{readOnly ? "pty-readonly" : "pty-writable"}</div>
	),
}));

const outcome: RuntimeOutcome = {
	id: "out-1",
	projectId: "proj",
	title: "Ship login",
	description: "Auth",
	status: "in_progress",
	createdAt: 1,
	updatedAt: 1,
};

const run: RuntimeAgentRun = {
	id: "run-1",
	outcomeId: "out-1",
	role: "worker",
	agent: "pi",
	tier: "T1",
	model: "kimi",
	prompt: "unit",
	worktreePath: null,
	piSessionPath: null,
	status: "running",
	reportedStatus: null,
	createdAt: 1,
	startedAt: 1,
	endedAt: null,
};

const events: RuntimeLedgerEvent[] = [
	{
		id: "e1",
		projectId: "proj",
		outcomeId: "out-1",
		runId: "run-1",
		kind: "spawn",
		payload: { agent: "pi", tier: "T1" },
		createdAt: 10,
	},
	{
		id: "e2",
		projectId: "proj",
		outcomeId: "out-1",
		runId: "run-1",
		kind: "tool_call",
		payload: { name: "edit", args: "src/auth.ts" },
		createdAt: 20,
	},
	{
		id: "e3",
		projectId: "proj",
		outcomeId: "out-1",
		runId: "run-1",
		kind: "status",
		payload: { status: "DONE" },
		createdAt: 30,
	},
];

describe("OutcomeWatchView", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
	});

	it("shows trail cards, watch banner, and unlocks Interject without Crush branding", async () => {
		await act(async () => {
			root.render(
				<OutcomeWatchView
					workspaceId="proj"
					outcome={outcome}
					runs={[run]}
					events={events}
					isLoadingTrail={false}
					selectedRunId="run-1"
					onSelectRun={() => {}}
					onReturnToFloor={() => {}}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onReturnToPhuong={() => {}}
				/>,
			);
		});

		expect(container.textContent).toContain("Ship login");
		expect(container.textContent).toContain("Watching this subagent");
		expect(container.textContent).toContain("pi");
		expect(container.textContent).toContain("edit");
		expect(container.textContent).toContain("DONE");
		expect(container.textContent).not.toMatch(/Crush|Charm/i);
		expect(container.querySelector(".kb-board")).toBeNull();

		const interject = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Interject",
		);
		expect(interject).toBeTruthy();
		await act(async () => {
			interject?.click();
		});
		expect(container.textContent).toContain("Interject unlocked — subagent input is available");
		expect(container.textContent).toContain("pty-writable");
	});

	it("shows the floor mosaic until a subagent is opened", async () => {
		await act(async () => {
			root.render(
				<OutcomeWatchView
					workspaceId="proj"
					outcome={outcome}
					runs={[run]}
					events={events}
					isLoadingTrail={false}
					selectedRunId={null}
					onSelectRun={() => {}}
					onReturnToFloor={() => {}}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onReturnToPhuong={() => {}}
				/>,
			);
		});

		expect(container.textContent).toContain("Floor — Phuong is running these subagents");
		expect(container.textContent).toContain("1 subagent");
		expect(container.textContent).not.toContain("Live terminal");
	});
});
