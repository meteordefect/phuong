import type { RuntimeLedgerEvent } from "@/runtime/types";

/** Snapshot has no ledger rows. Load via listEvents, then append live hub events by id. */
export function mergeLedgerEvents(
	loaded: readonly RuntimeLedgerEvent[],
	live: readonly RuntimeLedgerEvent[],
): RuntimeLedgerEvent[] {
	const byId = new Map<string, RuntimeLedgerEvent>();
	for (const event of loaded) {
		byId.set(event.id, event);
	}
	for (const event of live) {
		if (!byId.has(event.id)) {
			byId.set(event.id, event);
		}
	}
	return [...byId.values()].sort((left, right) => {
		if (left.createdAt !== right.createdAt) {
			return left.createdAt - right.createdAt;
		}
		return left.id.localeCompare(right.id);
	});
}
