import { describe, expect, it } from "vitest";

import { mergeLedgerEvents } from "@/components/trail/merge-ledger-events";
import type { RuntimeLedgerEvent } from "@/runtime/types";

function event(partial: Partial<RuntimeLedgerEvent> & Pick<RuntimeLedgerEvent, "id" | "kind">): RuntimeLedgerEvent {
	return {
		projectId: "proj",
		outcomeId: "out-1",
		runId: "run-1",
		payload: {},
		createdAt: 1,
		...partial,
	};
}

describe("mergeLedgerEvents", () => {
	it("uses listEvents rows then appends hub events without duplicating ids", () => {
		const loaded = [
			event({ id: "e1", kind: "spawn", createdAt: 10 }),
			event({ id: "e2", kind: "tool_call", createdAt: 20 }),
		];
		const live = [
			event({ id: "e2", kind: "tool_call", createdAt: 20 }),
			event({ id: "e3", kind: "status", createdAt: 30, payload: { status: "DONE" } }),
		];

		expect(mergeLedgerEvents(loaded, live).map((item) => item.id)).toEqual(["e1", "e2", "e3"]);
	});

	it("does not invent snapshot rows when only hub events exist", () => {
		const live = [event({ id: "live-1", kind: "user_message", createdAt: 5, runId: null })];
		expect(mergeLedgerEvents([], live)).toEqual(live);
	});
});
