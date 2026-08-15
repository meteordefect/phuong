export const LEDGER_SCHEMA_VERSION = 1;

export const LEDGER_MIGRATION_V1 = `
CREATE TABLE IF NOT EXISTS schema_migrations (
	version INTEGER PRIMARY KEY,
	applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	repo_path TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS outcomes (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL,
	title TEXT NOT NULL,
	description TEXT NOT NULL,
	status TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS agent_runs (
	id TEXT PRIMARY KEY,
	outcome_id TEXT NOT NULL,
	role TEXT NOT NULL,
	agent TEXT NOT NULL,
	tier TEXT,
	model TEXT,
	prompt TEXT NOT NULL,
	worktree_path TEXT,
	pi_session_path TEXT,
	status TEXT NOT NULL,
	reported_status TEXT,
	created_at INTEGER NOT NULL,
	started_at INTEGER,
	ended_at INTEGER,
	FOREIGN KEY (outcome_id) REFERENCES outcomes(id)
);

CREATE TABLE IF NOT EXISTS events (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL,
	outcome_id TEXT NOT NULL,
	run_id TEXT,
	kind TEXT NOT NULL,
	payload TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	FOREIGN KEY (project_id) REFERENCES projects(id),
	FOREIGN KEY (outcome_id) REFERENCES outcomes(id),
	FOREIGN KEY (run_id) REFERENCES agent_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_outcomes_project_id ON outcomes(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_outcome_id ON agent_runs(outcome_id);
CREATE INDEX IF NOT EXISTS idx_events_outcome_id_created_at ON events(outcome_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_run_id ON events(run_id);
`;

export interface LedgerMigration {
	version: number;
	sql: string;
}

export const LEDGER_MIGRATIONS: readonly LedgerMigration[] = [
	{
		version: 1,
		sql: LEDGER_MIGRATION_V1,
	},
];
