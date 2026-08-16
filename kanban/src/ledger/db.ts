import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { LEDGER_MIGRATIONS } from "./schema.js";

const RUNTIME_HOME_PARENT_DIR = ".cline";
const RUNTIME_HOME_DIR = "kanban";
const LEDGER_FILENAME = "ledger.sqlite";

export function getDefaultLedgerPath(): string {
	return join(homedir(), RUNTIME_HOME_PARENT_DIR, RUNTIME_HOME_DIR, LEDGER_FILENAME);
}

export interface LedgerDatabase {
	readonly path: string;
	readonly sqlite: DatabaseSync;
}

const openDatabases = new Map<string, LedgerDatabase>();

function applyMigrations(sqlite: DatabaseSync): void {
	sqlite.exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			applied_at INTEGER NOT NULL
		);
	`);
	const applied = new Set(
		sqlite
			.prepare("SELECT version FROM schema_migrations")
			.all()
			.map((row) => Number(row.version)),
	);
	for (const migration of LEDGER_MIGRATIONS) {
		if (applied.has(migration.version)) {
			continue;
		}
		sqlite.exec("BEGIN");
		try {
			sqlite.exec(migration.sql);
			sqlite
				.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
				.run(migration.version, Date.now());
			sqlite.exec("COMMIT");
		} catch (error) {
			sqlite.exec("ROLLBACK");
			throw error;
		}
	}
}

export function openLedger(dbPath: string = getDefaultLedgerPath()): LedgerDatabase {
	const existing = openDatabases.get(dbPath);
	if (existing) {
		return existing;
	}
	if (dbPath !== ":memory:") {
		mkdirSync(dirname(dbPath), { recursive: true });
	}
	const sqlite = new DatabaseSync(dbPath, {
		enableForeignKeyConstraints: true,
	});
	sqlite.exec("PRAGMA journal_mode = WAL");
	applyMigrations(sqlite);
	const ledger: LedgerDatabase = {
		path: dbPath,
		sqlite,
	};
	openDatabases.set(dbPath, ledger);
	return ledger;
}

export function closeLedger(dbPath: string = getDefaultLedgerPath()): void {
	const existing = openDatabases.get(dbPath);
	if (!existing) {
		return;
	}
	existing.sqlite.close();
	openDatabases.delete(dbPath);
}

export function closeAllLedgers(): void {
	for (const dbPath of [...openDatabases.keys()]) {
		closeLedger(dbPath);
	}
}
