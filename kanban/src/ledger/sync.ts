import type { RuntimeBoardCard, RuntimeBoardColumnId, RuntimeBoardData } from "../core/api-contract.js";
import { scrubJsonValue } from "../manager/credential-scrubber.js";
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
import type { LedgerEventKind, LedgerEventRecord, LedgerOutcomeStatus, LedgerRunStatus, LedgerTier } from "./types.js";

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

export interface PhuongLedgerIdentity {
	projectId: string;
	repoPath: string;
	outcomeId?: string | null;
}

export interface PhuongSdkTrailEvent {
	type: string;
	toolCallId?: string;
	toolName?: string;
	args?: unknown;
	result?: unknown;
	isError?: boolean;
	reason?: string;
	attempt?: number;
	maxAttempts?: number;
	success?: boolean;
	finalError?: string;
	assistantMessageEvent?: {
		type: string;
		error?: { errorMessage?: string };
		reason?: string;
	};
}

function formatPhuongToolResult(result: unknown): string {
	if (!result) {
		return "";
	}
	if (typeof result === "string") {
		return result;
	}
	if (typeof result === "object" && result !== null && "content" in result) {
		const typed = result as { content: { text?: string }[] };
		return typed.content.map((part) => part.text || "").join("\n");
	}
	return JSON.stringify(result, null, 2);
}

function scrubEventPayload(payload: Record<string, unknown>): Record<string, unknown> {
	const scrubbed = scrubJsonValue(payload);
	if (scrubbed && typeof scrubbed === "object" && !Array.isArray(scrubbed)) {
		return scrubbed as Record<string, unknown>;
	}
	return {};
}

export function mapPhuongSessionEventToLedger(
	event: PhuongSdkTrailEvent,
): { kind: LedgerEventKind; payload: Record<string, unknown> } | null {
	switch (event.type) {
		case "tool_execution_start":
			return {
				kind: "tool_call",
				payload: {
					toolCallId: event.toolCallId,
					name: event.toolName,
					args: event.args,
				},
			};
		case "tool_execution_end":
			return {
				kind: "tool_result",
				payload: {
					toolCallId: event.toolCallId,
					name: event.toolName,
					result: formatPhuongToolResult(event.result),
					isError: event.isError,
				},
			};
		case "compaction_start":
			return {
				kind: "system",
				payload: { type: event.type, reason: event.reason },
			};
		case "compaction_end":
			return {
				kind: "system",
				payload: { type: event.type, compacted: Boolean(event.result) },
			};
		case "auto_retry_start":
			return {
				kind: "system",
				payload: {
					type: event.type,
					attempt: event.attempt,
					maxAttempts: event.maxAttempts,
				},
			};
		case "auto_retry_end":
			return {
				kind: "system",
				payload: {
					type: event.type,
					success: event.success,
					error: event.finalError,
				},
			};
		case "message_update":
			if (event.assistantMessageEvent?.type === "error") {
				return {
					kind: "system",
					payload: {
						type: "llm_error",
						message:
							event.assistantMessageEvent.error?.errorMessage ||
							event.assistantMessageEvent.reason ||
							"LLM error",
					},
				};
			}
			return null;
		default:
			return null;
	}
}

export function recordPhuongTrailEvent(input: {
	projectId: string;
	repoPath: string;
	conversationId: string;
	outcomeId?: string | null;
	kind: LedgerEventKind;
	payload?: Record<string, unknown>;
	createdAt?: number;
	ledger?: LedgerDatabase;
}): LedgerEventRecord | null {
	try {
		const ledger = input.ledger ?? openLedger();
		recordProject(
			{
				projectId: input.projectId,
				repoPath: input.repoPath,
			},
			ledger,
		);
		const outcomeId = input.outcomeId || input.conversationId;
		const payload = scrubEventPayload({
			...(input.payload ?? {}),
			source: "phuong",
			conversationId: input.conversationId,
		});
		const payloadText = typeof payload.text === "string" ? payload.text : "";
		insertOutcomeIfMissing(ledger, {
			id: outcomeId,
			projectId: input.projectId,
			title: outcomeTitleFromPrompt(payloadText || "Phuong"),
			description: payloadText,
			status: "in_progress",
		});
		return appendEvent(ledger, {
			projectId: input.projectId,
			outcomeId,
			runId: null,
			kind: input.kind,
			payload,
			createdAt: input.createdAt,
		});
	} catch (error) {
		warnLedgerFailure("phuong event", error);
		return null;
	}
}

const GATE_OUTPUT_MAX_CHARS = 4000;

function resolveRunAndOutcome(
	ledger: LedgerDatabase,
	input: { taskId: string; workspaceId?: string; repoPath?: string },
): { runId: string; outcomeId: string; projectId: string } | null {
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
				prompt: "",
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
	return {
		runId: run.id,
		outcomeId: outcome.id,
		projectId: outcome.projectId,
	};
}

export function recordGateEvent(input: {
	taskId: string;
	workspaceId?: string;
	repoPath?: string;
	command: string;
	exitCode: number | null;
	output: string;
	error?: string;
	ledger?: LedgerDatabase;
}): LedgerEventRecord | null {
	try {
		const ledger = input.ledger ?? openLedger();
		const identity = resolveRunAndOutcome(ledger, input);
		if (!identity) {
			return null;
		}
		const payload = scrubEventPayload({
			command: input.command,
			exitCode: input.exitCode,
			output: input.output,
			passed: input.exitCode === 0,
			error: input.error,
			source: "phuong",
			taskId: input.taskId,
		});
		if (typeof payload.output === "string" && payload.output.length > GATE_OUTPUT_MAX_CHARS) {
			payload.output = payload.output.slice(0, GATE_OUTPUT_MAX_CHARS);
		}
		return appendEvent(ledger, {
			projectId: identity.projectId,
			outcomeId: identity.outcomeId,
			runId: identity.runId,
			kind: "gate",
			payload,
		});
	} catch (error) {
		warnLedgerFailure("gate", error);
		return null;
	}
}

export function recordArtifactEvent(input: {
	taskId: string;
	workspaceId?: string;
	repoPath?: string;
	artifact: {
		id: string;
		path: string;
		mimeType: string;
		label?: string;
		createdAt?: number;
	};
	ledger?: LedgerDatabase;
}): LedgerEventRecord | null {
	try {
		const ledger = input.ledger ?? openLedger();
		const identity = resolveRunAndOutcome(ledger, input);
		if (!identity) {
			return null;
		}
		return appendEvent(ledger, {
			projectId: identity.projectId,
			outcomeId: identity.outcomeId,
			runId: identity.runId,
			kind: "artifact",
			payload: scrubEventPayload({
				id: input.artifact.id,
				path: input.artifact.path,
				mimeType: input.artifact.mimeType,
				label: input.artifact.label,
				source: "phuong",
				taskId: input.taskId,
			}),
			createdAt: input.artifact.createdAt,
		});
	} catch (error) {
		warnLedgerFailure("artifact", error);
		return null;
	}
}
