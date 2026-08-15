import {
	importWorkspacesFromBoard,
	listEvents,
	listOutcomes,
	listProjects,
	listRuns,
	openLedger,
} from "../ledger/index.js";

export function createLedgerApi() {
	return {
		listProjects: async () => {
			const ledger = openLedger();
			await importWorkspacesFromBoard(ledger);
			return {
				projects: listProjects(ledger),
			};
		},
		listOutcomes: async (projectId: string) => {
			const ledger = openLedger();
			await importWorkspacesFromBoard(ledger);
			return {
				outcomes: listOutcomes(ledger, projectId),
			};
		},
		listRuns: async (outcomeId: string) => {
			const ledger = openLedger();
			await importWorkspacesFromBoard(ledger);
			return {
				runs: listRuns(ledger, outcomeId),
			};
		},
		listEvents: async (outcomeId: string) => {
			const ledger = openLedger();
			await importWorkspacesFromBoard(ledger);
			return {
				events: listEvents(ledger, outcomeId),
			};
		},
	};
}

export type LedgerApi = ReturnType<typeof createLedgerApi>;
