import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLedgerWorkspace } from "@/hooks/use-ledger-workspace";
import type { RuntimeLedgerEvent, RuntimeOutcome } from "@/runtime/types";

const listOutcomesQuery = vi.hoisted(() => vi.fn());
const listRunsQuery = vi.hoisted(() => vi.fn());
const listEventsQuery = vi.hoisted(() => vi.fn());

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		ledger: {
			listOutcomes: { query: listOutcomesQuery },
			listRuns: { query: listRunsQuery },
			listEvents: { query: listEventsQuery },
		},
	}),
}));

function event(id: string, kind: RuntimeLedgerEvent["kind"]): RuntimeLedgerEvent {
	return {
		id,
		projectId: "proj",
		outcomeId: "out-1",
		runId: kind === "user_message" ? null : "run-1",
		kind,
		payload: kind === "status" ? { status: "DONE" } : {},
		createdAt: 10,
	};
}

function HookHarness({
	hubEvents,
	onResult,
}: {
	hubEvents: Record<string, RuntimeLedgerEvent[]>;
	onResult: (result: ReturnType<typeof useLedgerWorkspace>) => void;
}): null {
	const result = useLedgerWorkspace({
		workspaceId: "proj",
		selectedOutcomeId: "out-1",
		hubEventsByOutcomeId: hubEvents,
	});
	onResult(result);
	return null;
}

describe("useLedgerWorkspace", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		listOutcomesQuery.mockReset();
		listRunsQuery.mockReset();
		listEventsQuery.mockReset();
		listOutcomesQuery.mockResolvedValue({
			outcomes: [
				{
					id: "out-1",
					projectId: "proj",
					title: "Ship login",
					description: "Auth",
					status: "in_progress",
					createdAt: 1,
					updatedAt: 1,
				} satisfies RuntimeOutcome,
			],
		});
		listRunsQuery.mockResolvedValue({
			runs: [
				{
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
				},
			],
		});
		listEventsQuery.mockResolvedValue({
			events: [event("db-1", "spawn")],
		});
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
	});

	it("loads listEvents then appends hub events for the selected outcome", async () => {
		const snapshots: Array<ReturnType<typeof useLedgerWorkspace>> = [];
		await act(async () => {
			root.render(
				<HookHarness
					hubEvents={{}}
					onResult={(result) => {
						snapshots.push(result);
					}}
				/>,
			);
		});
		await act(async () => {
			await Promise.resolve();
		});

		expect(listEventsQuery).toHaveBeenCalledWith({ outcomeId: "out-1" });
		expect(snapshots.at(-1)?.events.map((item) => item.id)).toEqual(["db-1"]);

		await act(async () => {
			root.render(
				<HookHarness
					hubEvents={{ "out-1": [event("hub-1", "status")] }}
					onResult={(result) => {
						snapshots.push(result);
					}}
				/>,
			);
		});

		expect(snapshots.at(-1)?.events.map((item) => item.id)).toEqual(["db-1", "hub-1"]);
	});
});
