import { randomUUID } from "node:crypto";
import type { SQLOutputValue } from "node:sqlite";

import type { LedgerDatabase } from "./db.js";
import {
	LEDGER_EVENT_KINDS,
	LEDGER_OUTCOME_STATUSES,
	LEDGER_REPORTED_STATUSES,
	LEDGER_RUN_ROLES,
	LEDGER_RUN_STATUSES,
	LEDGER_TIERS,
	type LedgerAgentRunRecord,
	type LedgerAppendEventInput,
	type LedgerEventKind,
	type LedgerEventRecord,
	type LedgerInsertOutcomeInput,
	type LedgerInsertRunInput,
	type LedgerOutcomeRecord,
	type LedgerOutcomeStatus,
	type LedgerProjectRecord,
	type LedgerReportedStatus,
	type LedgerRunRole,
	type LedgerRunStatus,
	type LedgerTier,
	type LedgerUpsertProjectInput,
} from "./types.js";

type SqlRow = Record<string, SQLOutputValue>;

function asString(value: SQLOutputValue | undefined, fallback = ""): string {
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "number" || typeof value === "bigint") {
		return String(value);
	}
	return fallback;
}

function asNullableString(value: SQLOutputValue | undefined): string | null {
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "number" || typeof value === "bigint") {
		return String(value);
	}
	return null;
}

function asNumber(value: SQLOutputValue | undefined, fallback = 0): number {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "bigint") {
		return Number(value);
	}
	if (typeof value === "string") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : fallback;
	}
	return fallback;
}

function asNullableNumber(value: SQLOutputValue | undefined): number | null {
	if (value === null || value === undefined) {
		return null;
	}
	const parsed = asNumber(value, Number.NaN);
	return Number.isFinite(parsed) ? parsed : null;
}

function parseJsonObject(raw: string): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// Keep an empty object for malformed historical rows.
	}
	return {};
}

function isLedgerOutcomeStatus(value: string): value is LedgerOutcomeStatus {
	return (LEDGER_OUTCOME_STATUSES as readonly string[]).includes(value);
}

function isLedgerRunStatus(value: string): value is LedgerRunStatus {
	return (LEDGER_RUN_STATUSES as readonly string[]).includes(value);
}

function isLedgerRunRole(value: string): value is LedgerRunRole {
	return (LEDGER_RUN_ROLES as readonly string[]).includes(value);
}

function isLedgerEventKind(value: string): value is LedgerEventKind {
	return (LEDGER_EVENT_KINDS as readonly string[]).includes(value);
}

function isLedgerTier(value: string): value is LedgerTier {
	return (LEDGER_TIERS as readonly string[]).includes(value);
}

function isLedgerReportedStatus(value: string): value is LedgerReportedStatus {
	return (LEDGER_REPORTED_STATUSES as readonly string[]).includes(value);
}

function mapProject(row: SqlRow): LedgerProjectRecord {
	return {
		id: asString(row.id),
		name: asString(row.name),
		repoPath: asString(row.repo_path),
		createdAt: asNumber(row.created_at),
		updatedAt: asNumber(row.updated_at),
	};
}

function mapOutcome(row: SqlRow): LedgerOutcomeRecord {
	const statusRaw = asString(row.status, "open");
	return {
		id: asString(row.id),
		projectId: asString(row.project_id),
		title: asString(row.title),
		description: asString(row.description),
		status: isLedgerOutcomeStatus(statusRaw) ? statusRaw : "open",
		createdAt: asNumber(row.created_at),
		updatedAt: asNumber(row.updated_at),
	};
}

function mapRun(row: SqlRow): LedgerAgentRunRecord {
	const roleRaw = asString(row.role, "worker");
	const statusRaw = asString(row.status, "queued");
	const tierRaw = asNullableString(row.tier);
	const reportedRaw = asNullableString(row.reported_status);
	return {
		id: asString(row.id),
		outcomeId: asString(row.outcome_id),
		role: isLedgerRunRole(roleRaw) ? roleRaw : "worker",
		agent: asString(row.agent, "pi"),
		tier: tierRaw && isLedgerTier(tierRaw) ? tierRaw : null,
		model: asNullableString(row.model),
		prompt: asString(row.prompt),
		worktreePath: asNullableString(row.worktree_path),
		piSessionPath: asNullableString(row.pi_session_path),
		status: isLedgerRunStatus(statusRaw) ? statusRaw : "queued",
		reportedStatus: reportedRaw && isLedgerReportedStatus(reportedRaw) ? reportedRaw : null,
		createdAt: asNumber(row.created_at),
		startedAt: asNullableNumber(row.started_at),
		endedAt: asNullableNumber(row.ended_at),
	};
}

function mapEvent(row: SqlRow): LedgerEventRecord {
	const kindRaw = asString(row.kind, "system");
	return {
		id: asString(row.id),
		projectId: asString(row.project_id),
		outcomeId: asString(row.outcome_id),
		runId: asNullableString(row.run_id),
		kind: isLedgerEventKind(kindRaw) ? kindRaw : "system",
		payload: parseJsonObject(asString(row.payload, "{}")),
		createdAt: asNumber(row.created_at),
	};
}

export function upsertProject(ledger: LedgerDatabase, input: LedgerUpsertProjectInput): LedgerProjectRecord {
	const now = Date.now();
	const createdAt = input.createdAt ?? now;
	const updatedAt = input.updatedAt ?? now;
	ledger.sqlite
		.prepare(
			`INSERT INTO projects (id, name, repo_path, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET
			 	name = excluded.name,
			 	repo_path = excluded.repo_path,
			 	updated_at = excluded.updated_at`,
		)
		.run(input.id, input.name, input.repoPath, createdAt, updatedAt);
	const row = ledger.sqlite.prepare("SELECT * FROM projects WHERE id = ?").get(input.id);
	if (!row) {
		throw new Error(`Failed to upsert project ${input.id}.`);
	}
	return mapProject(row);
}

export function insertOutcomeIfMissing(
	ledger: LedgerDatabase,
	input: LedgerInsertOutcomeInput,
): { outcome: LedgerOutcomeRecord; inserted: boolean } {
	const now = Date.now();
	const createdAt = input.createdAt ?? now;
	const updatedAt = input.updatedAt ?? now;
	const result = ledger.sqlite
		.prepare(
			`INSERT OR IGNORE INTO outcomes (id, project_id, title, description, status, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(input.id, input.projectId, input.title, input.description, input.status, createdAt, updatedAt);
	const row = ledger.sqlite.prepare("SELECT * FROM outcomes WHERE id = ?").get(input.id);
	if (!row) {
		throw new Error(`Failed to read outcome ${input.id}.`);
	}
	return {
		outcome: mapOutcome(row),
		inserted: result.changes > 0,
	};
}

export function insertRunIfMissing(
	ledger: LedgerDatabase,
	input: LedgerInsertRunInput,
): { run: LedgerAgentRunRecord; inserted: boolean } {
	const now = Date.now();
	const createdAt = input.createdAt ?? now;
	const result = ledger.sqlite
		.prepare(
			`INSERT OR IGNORE INTO agent_runs (
				id, outcome_id, role, agent, tier, model, prompt, worktree_path, pi_session_path,
				status, reported_status, created_at, started_at, ended_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			input.id,
			input.outcomeId,
			input.role ?? "worker",
			input.agent ?? "pi",
			input.tier ?? null,
			input.model ?? null,
			input.prompt,
			input.worktreePath ?? null,
			input.piSessionPath ?? null,
			input.status,
			input.reportedStatus ?? null,
			createdAt,
			input.startedAt ?? null,
			input.endedAt ?? null,
		);
	const row = ledger.sqlite.prepare("SELECT * FROM agent_runs WHERE id = ?").get(input.id);
	if (!row) {
		throw new Error(`Failed to read agent run ${input.id}.`);
	}
	return {
		run: mapRun(row),
		inserted: result.changes > 0,
	};
}

export function getProject(ledger: LedgerDatabase, projectId: string): LedgerProjectRecord | null {
	const row = ledger.sqlite.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
	return row ? mapProject(row) : null;
}

export function getOutcome(ledger: LedgerDatabase, outcomeId: string): LedgerOutcomeRecord | null {
	const row = ledger.sqlite.prepare("SELECT * FROM outcomes WHERE id = ?").get(outcomeId);
	return row ? mapOutcome(row) : null;
}

export function getRun(ledger: LedgerDatabase, runId: string): LedgerAgentRunRecord | null {
	const row = ledger.sqlite.prepare("SELECT * FROM agent_runs WHERE id = ?").get(runId);
	return row ? mapRun(row) : null;
}

export function listProjects(ledger: LedgerDatabase): LedgerProjectRecord[] {
	return ledger.sqlite.prepare("SELECT * FROM projects ORDER BY name COLLATE NOCASE, id").all().map(mapProject);
}

export function listOutcomes(ledger: LedgerDatabase, projectId: string): LedgerOutcomeRecord[] {
	return ledger.sqlite
		.prepare("SELECT * FROM outcomes WHERE project_id = ? ORDER BY created_at DESC, id")
		.all(projectId)
		.map(mapOutcome);
}

export function listRuns(ledger: LedgerDatabase, outcomeId: string): LedgerAgentRunRecord[] {
	return ledger.sqlite
		.prepare("SELECT * FROM agent_runs WHERE outcome_id = ? ORDER BY created_at ASC, id")
		.all(outcomeId)
		.map(mapRun);
}

export function listEvents(ledger: LedgerDatabase, outcomeId: string): LedgerEventRecord[] {
	return ledger.sqlite
		.prepare("SELECT * FROM events WHERE outcome_id = ? ORDER BY created_at ASC, id")
		.all(outcomeId)
		.map(mapEvent);
}

export function updateRunStatus(
	ledger: LedgerDatabase,
	runId: string,
	patch: {
		status: LedgerRunStatus;
		startedAt?: number | null;
		endedAt?: number | null;
		worktreePath?: string | null;
		model?: string | null;
	},
): LedgerAgentRunRecord | null {
	const existing = getRun(ledger, runId);
	if (!existing) {
		return null;
	}
	ledger.sqlite
		.prepare(
			`UPDATE agent_runs
			 SET status = ?,
			     started_at = COALESCE(?, started_at),
			     ended_at = COALESCE(?, ended_at),
			     worktree_path = COALESCE(?, worktree_path),
			     model = COALESCE(?, model)
			 WHERE id = ?`,
		)
		.run(
			patch.status,
			patch.startedAt ?? null,
			patch.endedAt ?? null,
			patch.worktreePath ?? null,
			patch.model ?? null,
			runId,
		);
	return getRun(ledger, runId);
}

export function updateOutcomeStatus(
	ledger: LedgerDatabase,
	outcomeId: string,
	status: LedgerOutcomeStatus,
	updatedAt: number = Date.now(),
): LedgerOutcomeRecord | null {
	const existing = getOutcome(ledger, outcomeId);
	if (!existing) {
		return null;
	}
	ledger.sqlite
		.prepare("UPDATE outcomes SET status = ?, updated_at = ? WHERE id = ?")
		.run(status, updatedAt, outcomeId);
	return getOutcome(ledger, outcomeId);
}

export function appendEvent(ledger: LedgerDatabase, input: LedgerAppendEventInput): LedgerEventRecord {
	const id = randomUUID();
	const createdAt = input.createdAt ?? Date.now();
	const payload = JSON.stringify(input.payload ?? {});
	ledger.sqlite
		.prepare(
			`INSERT INTO events (id, project_id, outcome_id, run_id, kind, payload, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(id, input.projectId, input.outcomeId, input.runId ?? null, input.kind, payload, createdAt);
	const row = ledger.sqlite.prepare("SELECT * FROM events WHERE id = ?").get(id);
	if (!row) {
		throw new Error(`Failed to append event ${id}.`);
	}
	return mapEvent(row);
}
