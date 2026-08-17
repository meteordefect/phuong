import { describe, expect, it } from "vitest";

import { eventsForRun, mosaicColumnCount } from "@/components/subagent-mosaic";
import type { RuntimeLedgerEvent } from "@/runtime/types";

describe("subagent mosaic", () => {
	it("splits the floor by how many subagents are working", () => {
		expect(mosaicColumnCount(1)).toBe(1);
		expect(mosaicColumnCount(2)).toBe(2);
		expect(mosaicColumnCount(4)).toBe(2);
		expect(mosaicColumnCount(5)).toBe(3);
		expect(mosaicColumnCount(10)).toBe(4);
	});

	it("keeps each pane on that subagent's run events", () => {
		const events: RuntimeLedgerEvent[] = [
			{
				id: "a",
				projectId: "p",
				outcomeId: "o",
				runId: "run-1",
				kind: "spawn",
				payload: {},
				createdAt: 1,
			},
			{
				id: "b",
				projectId: "p",
				outcomeId: "o",
				runId: "run-2",
				kind: "status",
				payload: { status: "DONE" },
				createdAt: 2,
			},
		];
		expect(eventsForRun(events, "run-1").map((event) => event.id)).toEqual(["a"]);
	});
});
