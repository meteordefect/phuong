import type { RuntimeBoardCard, RuntimeBoardColumnId, RuntimeBoardData } from "../core/api-contract.js";
import { captureNodeException } from "../telemetry/sentry-node.js";
import { type LedgerDatabase, openLedger } from "./db.js";
import {
	appendEvent,
	getOutcome,
	getRun,
	insertOutcomeIfMissing,
	insertRunIfMissing,
	updateOutcomeStatus,
	updateRunStatus,
	upsertProject,
} from "./queries.js";
import type { LedgerEventRecord, LedgerOutcomeStatus, LedgerRunStatus, LedgerTier } from "./types.js";

export interface LedgerCardIntent {
	cardId: string;
	prompt: string;
	model?: string | null;
	tier?: LedgerTier | null;
	createdAt?: number;
	updatedAt?: number;
	columnId?: RuntimeBoardColumnId;
	sessionState?: string | null;
	sessionStartedAt?: number | null;
	worktreePath?: string | null;
}

export interface LedgerProjectIdentity {
	projectId: string;
	repoPath: string;
	name?: string;
}

function projectNameFromRepoPath(repoPath: string): string {
	const normalized = repoPath.replaceAll("\\", "/").replace(/\/+$/g, "");
	const segments = normalized.split("/").filter((segment) => segment.length > 0);
	return segments[segments.length - 1] ?? normalized;
}

export function outcomeTitleFromPrompt(prompt: string): string {
	const firstLine = prompt.trim().split(/\r?\n/, 1)[0] ?? "";
	const stripped = firstLine.replace(/^#+\s*/, "").trim();
	if (!stripped) {
		return "Untitled outcome";
	}
	if (stripped.length <= 80) {
		return stripped;
	}
	return `${stripped.slice(0, 77)}...`;
}

export function mapColumnToLedgerStatuses(
	columnId: RuntimeBoardColumnId | undefined,
	sessionState?: string | null,
): { outcomeStatus: LedgerOutcomeStatus; runStatus: LedgerRunStatus } {
	if (sessionState === "running") {
		return { outcomeStatus: "in_progress", runStatus: "running" };
	}
	switch (columnId) {
		case "in_progress":
			return { outcomeStatus: "in_progress", runStatus: "queued" };
		case "review":
			return { outcomeStatus: "verifying", runStatus: "done" };
		case "trash":
			return { outcomeStatus: "parked", runStatus: "done" };
		default:
			return { outcomeStatus: "open", runStatus: "queued" };
	}
}

function warnLedgerFailure(action: string, error: unknown): void {
	captureNodeException(error, { area: `ledger-${action}` });
}

export function recordProject(identity: LedgerProjectIdentity, ledger: LedgerDatabase = openLedger()): void {
	upsertProject(ledger, {
		id: identity.projectId,
		name: identity.name ?? projectNameFromRepoPath(identity.repoPath),
		repoPath: identity.repoPath,
	});
}

export function recordOutcomeAndRunFromCard(
	identity: LedgerProjectIdentity,
	card: LedgerCardIntent,
	ledger: LedgerDatabase = openLedger(),
): void {
	recordProject(identity, ledger);
	const statuses = mapColumnToLedgerStatuses(card.columnId, card.sessionState);
	insertOutcomeIfMissing(ledger, {
		id: card.cardId,
		projectId: identity.projectId,
		title: outcomeTitleFromPrompt(card.prompt),
		description: card.prompt,
		status: statuses.outcomeStatus,
		createdAt: card.createdAt,
		updatedAt: card.updatedAt ?? card.createdAt,
	});
	insertRunIfMissing(ledger, {
		id: card.cardId,
		outcomeId: card.cardId,
		role: "worker",
		agent: "pi",
		tier: card.tier ?? null,
		model: card.model ?? null,
		prompt: card.prompt,
		worktreePath: card.worktreePath ?? null,
		status: statuses.runStatus,
		createdAt: card.createdAt,
		startedAt: statuses.runStatus === "running" ? (card.sessionStartedAt ?? card.createdAt ?? null) : null,
	});
}

export function collectBoardCards(board: RuntimeBoardData): Array<{
	columnId: RuntimeBoardColumnId;
	card: RuntimeBoardCard;
}> {
	const cards: Array<{ columnId: RuntimeBoardColumnId; card: RuntimeBoardCard }> = [];
	for (const column of board.columns) {
		for (const card of column.cards) {
			cards.push({ columnId: column.id, card });
		}
	}
	return cards;
}

export function syncBoardCardsToLedger(input: {
	projectId: string;
	repoPath: string;
	board: RuntimeBoardData;
	sessions?: Record<string, { state?: string; startedAt?: number | null; workspacePath?: string | null }>;
	ledger?: LedgerDatabase;
}): void {
	try {
		const ledger = input.ledger ?? openLedger();
		const identity: LedgerProjectIdentity = {
			projectId: input.projectId,
			repoPath: input.repoPath,
		};
		recordProject(identity, ledger);
		for (const { columnId, card } of collectBoardCards(input.board)) {
			const session = input.sessions?.[card.id];
			recordOutcomeAndRunFromCard(
				identity,
				{
					cardId: card.id,
					prompt: card.prompt,
					model: card.model,
					tier: card.tier,
					createdAt: card.createdAt,
					updatedAt: card.updatedAt,
					columnId,
					sessionState: session?.state,
					sessionStartedAt: session?.startedAt,
					worktreePath: session?.workspacePath,
				},
				ledger,
			);
		}
	} catch (error) {
		warnLedgerFailure("board sync", error);
	}
}

export function recordCreatedChatIntent(input: {
	projectId: string;
	repoPath: string;
	cardId: string;
	prompt: string;
	model?: string | null;
	tier?: LedgerTier | null;
	createdAt?: number;
}): void {
	try {
		recordOutcomeAndRunFromCard(
			{
				projectId: input.projectId,
				repoPath: input.repoPath,
			},
			{
				cardId: input.cardId,
				prompt: input.prompt,
				model: input.model,
				tier: input.tier,
				createdAt: input.createdAt,
				columnId: "backlog",
			},
		);
	} catch (error) {
		warnLedgerFailure("create chat", error);
	}
}

export function recordRunSpawn(input: {
	taskId: string;
	workspaceId?: string;
	repoPath?: string;
	agent?: string;
	model?: string | null;
	tier?: LedgerTier | null;
	prompt?: string;
	worktreePath?: string | null;
}): LedgerEventRecord | null {
	try {
		const ledger = openLedger();
		let run = getRun(ledger, input.taskId);
		let outcome = getOutcome(ledger, input.taskId);
		if (!run || !outcome) {
			if (!input.workspaceId) {
				return null;
			}
			recordOutcomeAndRunFromCard(
				{
					projectId: input.workspaceId,
					repoPath: input.repoPath ?? "",
				},
				{
					cardId: input.taskId,
					prompt: input.prompt ?? "",
					model: input.model,
					tier: input.tier,
					columnId: "backlog",
				},
				ledger,
			);
			run = getRun(ledger, input.taskId);
			outcome = getOutcome(ledger, input.taskId);
		}
		if (!run || !outcome) {
			return null;
		}
		const startedAt = Date.now();
		updateRunStatus(ledger, run.id, {
			status: "running",
			startedAt,
			worktreePath: input.worktreePath ?? null,
			model: input.model ?? null,
		});
		updateOutcomeStatus(ledger, outcome.id, "in_progress", startedAt);
		return appendEvent(ledger, {
			projectId: outcome.projectId,
			outcomeId: outcome.id,
			runId: run.id,
			kind: "spawn",
			payload: {
				agent: input.agent ?? run.agent,
				model: input.model ?? run.model,
				tier: input.tier ?? run.tier,
				taskId: input.taskId,
			},
			createdAt: startedAt,
		});
	} catch (error) {
		warnLedgerFailure("spawn", error);
		return null;
	}
}
