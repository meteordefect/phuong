export const LEDGER_OUTCOME_STATUSES = ["open", "in_progress", "verifying", "done", "blocked", "parked"] as const;
export type LedgerOutcomeStatus = (typeof LEDGER_OUTCOME_STATUSES)[number];

export const LEDGER_RUN_STATUSES = ["queued", "running", "done", "failed", "blocked", "needs_context"] as const;
export type LedgerRunStatus = (typeof LEDGER_RUN_STATUSES)[number];

export const LEDGER_RUN_ROLES = ["worker", "verifier", "gate"] as const;
export type LedgerRunRole = (typeof LEDGER_RUN_ROLES)[number];

export const LEDGER_EVENT_KINDS = [
	"user_message",
	"assistant_message",
	"tool_call",
	"tool_result",
	"status",
	"gate",
	"artifact",
	"file_change",
	"spawn",
	"system",
] as const;
export type LedgerEventKind = (typeof LEDGER_EVENT_KINDS)[number];

export const LEDGER_REPORTED_STATUSES = ["DONE", "DONE_WITH_CONCERNS", "NEEDS_CONTEXT", "BLOCKED"] as const;
export type LedgerReportedStatus = (typeof LEDGER_REPORTED_STATUSES)[number];

export const LEDGER_TIERS = ["T0", "T1", "T2", "T3"] as const;
export type LedgerTier = (typeof LEDGER_TIERS)[number];

export interface LedgerProjectRecord {
	id: string;
	name: string;
	repoPath: string;
	createdAt: number;
	updatedAt: number;
}

export interface LedgerOutcomeRecord {
	id: string;
	projectId: string;
	title: string;
	description: string;
	status: LedgerOutcomeStatus;
	createdAt: number;
	updatedAt: number;
}

export interface LedgerAgentRunRecord {
	id: string;
	outcomeId: string;
	role: LedgerRunRole;
	agent: string;
	tier: LedgerTier | null;
	model: string | null;
	prompt: string;
	worktreePath: string | null;
	piSessionPath: string | null;
	status: LedgerRunStatus;
	reportedStatus: LedgerReportedStatus | null;
	createdAt: number;
	startedAt: number | null;
	endedAt: number | null;
}

export interface LedgerEventRecord {
	id: string;
	projectId: string;
	outcomeId: string;
	runId: string | null;
	kind: LedgerEventKind;
	payload: Record<string, unknown>;
	createdAt: number;
}

export interface LedgerAppendEventInput {
	projectId: string;
	outcomeId: string;
	runId?: string | null;
	kind: LedgerEventKind;
	payload?: Record<string, unknown>;
	createdAt?: number;
}

export interface LedgerUpsertProjectInput {
	id: string;
	name: string;
	repoPath: string;
	createdAt?: number;
	updatedAt?: number;
}

export interface LedgerInsertOutcomeInput {
	id: string;
	projectId: string;
	title: string;
	description: string;
	status: LedgerOutcomeStatus;
	createdAt?: number;
	updatedAt?: number;
}

export interface LedgerInsertRunInput {
	id: string;
	outcomeId: string;
	role?: LedgerRunRole;
	agent?: string;
	tier?: LedgerTier | null;
	model?: string | null;
	prompt: string;
	worktreePath?: string | null;
	piSessionPath?: string | null;
	status: LedgerRunStatus;
	reportedStatus?: LedgerReportedStatus | null;
	createdAt?: number;
	startedAt?: number | null;
	endedAt?: number | null;
}
