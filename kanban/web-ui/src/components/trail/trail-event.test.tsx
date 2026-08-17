import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TrailEvent } from "@/components/trail/trail-event";
import type { RuntimeLedgerEvent } from "@/runtime/types";

function event(partial: Partial<RuntimeLedgerEvent> & Pick<RuntimeLedgerEvent, "id" | "kind">): RuntimeLedgerEvent {
	return {
		projectId: "proj",
		outcomeId: "out-1",
		runId: "run-1",
		payload: {},
		createdAt: Date.parse("2026-08-17T06:00:00.000Z"),
		...partial,
	};
}

describe("TrailEvent", () => {
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

	it("renders spawn, tool, and status cards from ledger payloads", () => {
		act(() => {
			root.render(
				<div>
					<TrailEvent
						event={event({
							id: "spawn",
							kind: "spawn",
							payload: { agent: "pi", tier: "T1", model: "kimi" },
						})}
					/>
					<TrailEvent
						event={event({
							id: "tool",
							kind: "tool_call",
							payload: { name: "edit", args: "src/auth.ts" },
						})}
					/>
					<TrailEvent
						event={event({
							id: "status",
							kind: "status",
							payload: { status: "DONE" },
						})}
					/>
				</div>,
			);
		});

		expect(container.querySelector('[data-trail-kind="spawn"]')?.textContent).toContain("pi");
		expect(container.querySelector('[data-trail-kind="tool_call"]')?.textContent).toContain("edit");
		expect(container.querySelector('[data-trail-kind="status"]')?.textContent).toContain("DONE");
		expect(container.textContent).not.toMatch(/Crush|Charm/i);
	});
});
