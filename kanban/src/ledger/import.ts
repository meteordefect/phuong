import { listWorkspaceIndexEntries, loadWorkspaceState } from "../state/workspace-state.js";
import { captureNodeException } from "../telemetry/sentry-node.js";
import { type LedgerDatabase, openLedger } from "./db.js";
import { syncBoardCardsToLedger } from "./sync.js";

const importedLedgerPaths = new Set<string>();

export interface LedgerImportResult {
	projects: number;
	outcomes: number;
	runs: number;
}

export async function importWorkspacesFromBoard(ledger: LedgerDatabase = openLedger()): Promise<LedgerImportResult> {
	if (importedLedgerPaths.has(ledger.path)) {
		return { projects: 0, outcomes: 0, runs: 0 };
	}

	const entries = await listWorkspaceIndexEntries();
	let projects = 0;
	let outcomes = 0;
	let runs = 0;
	for (const entry of entries) {
		try {
			const state = await loadWorkspaceState(entry.repoPath);
			const beforeOutcomes = ledger.sqlite
				.prepare("SELECT COUNT(*) AS count FROM outcomes WHERE project_id = ?")
				.get(entry.workspaceId);
			syncBoardCardsToLedger({
				projectId: entry.workspaceId,
				repoPath: entry.repoPath,
				board: state.board,
				sessions: state.sessions,
				ledger,
			});
			const afterOutcomes = ledger.sqlite
				.prepare("SELECT COUNT(*) AS count FROM outcomes WHERE project_id = ?")
				.get(entry.workspaceId);
			projects += 1;
			const beforeCount = typeof beforeOutcomes?.count === "number" ? beforeOutcomes.count : 0;
			const afterCount = typeof afterOutcomes?.count === "number" ? afterOutcomes.count : 0;
			const added = Math.max(0, afterCount - beforeCount);
			outcomes += added;
			runs += added;
		} catch (error) {
			captureNodeException(error, { area: "ledger-import" });
		}
	}
	importedLedgerPaths.add(ledger.path);
	return { projects, outcomes, runs };
}

export function resetLedgerImportState(dbPath?: string): void {
	if (dbPath) {
		importedLedgerPaths.delete(dbPath);
		return;
	}
	importedLedgerPaths.clear();
}
