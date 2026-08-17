import { parseSessionEntries } from "@mariozechner/pi-coding-agent";
import { readFile } from "node:fs/promises";

import type { RuntimeHookEvent, RuntimeTaskHookActivity } from "../core/api-contract.js";
import { parseTaskAgentStatus } from "../manager/task-status-protocol.js";
import { scrubJsonValue } from "../manager/credential-scrubber.js";
import { captureNodeException } from "../telemetry/sentry-node.js";
import { type LedgerDatabase, openLedger } from "./db.js";
import {
	appendEvent,
	getRun,
	getRunWithOutcome,
	listEvents,
	updateOutcomeStatus,
	updateRunStatus,
} from "./queries.js";
import { recordOutcomeAndRunFromCard, recordProject } from "./sync.js";
import type {
	LedgerEventKind,
	LedgerEventRecord,
	LedgerOutcomeStatus,
	LedgerReportedStatus,
	LedgerRunStatus,
} from "./types.js";

export interface PiMappedTrailEvent {
	kind: LedgerEventKind;
	payload: Record<string, unknown>;
	createdAt?: number;
}

export interface PiHookIngestInput {
	taskId: string;
	workspaceId: string;
	repoPath?: string;
	event: RuntimeHookEvent;
	metadata?: Partial<RuntimeTaskHookActivity>;
	ledger?: LedgerDatabase;
}

function warnPiIngestFailure(action: string, error: unknown): void {
	captureNodeException(error, { area: `ledger-pi-${action}` });
}

function scrubEventPayload(payload: Record<string, unknown>): Record<string, unknown> {
	const scrubbed = scrubJsonValue(payload);
	if (scrubbed && typeof scrubbed === "object" && !Array.isArray(scrubbed)) {
		return scrubbed as Record<string, unknown>;
	}
	return {};
}

function extractTextContent(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.filter((block) => {
			if (!block || typeof block !== "object") {
				return false;
			}
			return (block as { type?: string }).type === "text";
		})
		.map((block) => (block as { text?: string }).text || "")
		.join("\n");
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}

function eventFingerprint(kind: LedgerEventKind, payload: Record<string, unknown>): string {
	const toolCallId = typeof payload.toolCallId === "string" ? payload.toolCallId : "";
	if (toolCallId) {
		return `${kind}:${toolCallId}`;
	}
	if (kind === "status" && typeof payload.status === "string") {
		return `status:${payload.status}`;
	}
	if (typeof payload.text === "string") {
		return `${kind}:${payload.text.slice(0, 80)}`;
	}
	return `${kind}:${JSON.stringify(payload).slice(0, 80)}`;
}

export function mapReportedStatusToRunState(status: LedgerReportedStatus): {
	runStatus: LedgerRunStatus;
	outcomeStatus: LedgerOutcomeStatus;
} {
	switch (status) {
		case "NEEDS_CONTEXT":
			return { runStatus: "needs_context", outcomeStatus: "blocked" };
		case "BLOCKED":
			return { runStatus: "blocked", outcomeStatus: "blocked" };
		default:
			return { runStatus: "done", outcomeStatus: "verifying" };
	}
}

export function mapHookEventToLedgerStatuses(event: RuntimeHookEvent): {
	runStatus: LedgerRunStatus;
	outcomeStatus: LedgerOutcomeStatus;
} | null {
	if (event === "to_in_progress") {
		return { runStatus: "running", outcomeStatus: "in_progress" };
	}
	if (event === "to_review") {
		return { runStatus: "done", outcomeStatus: "verifying" };
	}
	return null;
}

export function mapPiHookActivityToLedger(
	event: RuntimeHookEvent,
	metadata?: Partial<RuntimeTaskHookActivity>,
): PiMappedTrailEvent[] {
	const mapped: PiMappedTrailEvent[] = [];
	const hookEventName = metadata?.hookEventName ?? null;
	const toolName = metadata?.toolName ?? null;
	const toolInputSummary = metadata?.toolInputSummary ?? null;
	const activityText = metadata?.activityText ?? null;
	const finalMessage = metadata?.finalMessage ?? null;

	if (hookEventName === "tool_call" && toolName) {
		mapped.push({
			kind: "tool_call",
			payload: {
				name: toolName,
				args: toolInputSummary ?? activityText,
				source: "pi",
			},
		});
	} else if (hookEventName === "tool_result" && (toolName || activityText)) {
		mapped.push({
			kind: "tool_result",
			payload: {
				name: toolName,
				result: activityText,
				source: "pi",
			},
		});
	} else if (event === "activity" && toolName) {
		mapped.push({
			kind: "tool_result",
			payload: {
				name: toolName,
				result: activityText ?? toolInputSummary,
				source: "pi",
			},
		});
	}

	const statusText = finalMessage ?? activityText;
	const reported = parseTaskAgentStatus(statusText);
	if (reported) {
		mapped.push({
			kind: "status",
			payload: {
				status: reported.status,
				reason: reported.reason,
				source: "pi",
			},
		});
	} else if (hookEventName === "agent_end" && finalMessage?.trim()) {
		mapped.push({
			kind: "assistant_message",
			payload: {
				text: finalMessage,
				source: "pi",
			},
		});
	}

	return mapped;
}

export function mapPiSessionEntriesToLedger(entries: readonly unknown[]): PiMappedTrailEvent[] {
	const mapped: PiMappedTrailEvent[] = [];
	for (const entry of entries) {
		const wrapper = asRecord(entry);
		if (!wrapper || wrapper.type !== "message") {
			continue;
		}
		const record = asRecord(wrapper.message);
		if (!record) {
			continue;
		}
		const createdAt = Date.parse(typeof wrapper.timestamp === "string" ? wrapper.timestamp : "");
		const timestamp = Number.isFinite(createdAt) ? createdAt : undefined;
		const role = typeof record.role === "string" ? record.role : "";
		if (role === "user") {
			const text = extractTextContent(record.content);
			if (text.trim()) {
				mapped.push({
					kind: "user_message",
					payload: { text, source: "pi" },
					createdAt: timestamp,
				});
			}
			continue;
		}
		if (role === "assistant") {
			const text = extractTextContent(record.content);
			if (text.trim()) {
				mapped.push({
					kind: "assistant_message",
					payload: { text, source: "pi" },
					createdAt: timestamp,
				});
			}
			if (Array.isArray(record.content)) {
				for (const block of record.content) {
					const item = asRecord(block);
					if (!item || item.type !== "toolCall") {
						continue;
					}
					mapped.push({
						kind: "tool_call",
						payload: {
							toolCallId: item.id,
							name: item.name,
							args: item.arguments,
							source: "pi",
						},
						createdAt: timestamp,
					});
				}
			}
			const reported = parseTaskAgentStatus(text);
			if (reported) {
				mapped.push({
					kind: "status",
					payload: {
						status: reported.status,
						reason: reported.reason,
						source: "pi",
					},
					createdAt: timestamp,
				});
			}
			continue;
		}
		if (role === "toolResult") {
			mapped.push({
				kind: "tool_result",
				payload: {
					toolCallId: record.toolCallId,
					name: record.toolName,
					result: extractTextContent(record.content),
					isError: Boolean(record.isError),
					source: "pi",
				},
				createdAt: timestamp,
			});
		}
	}
	return mapped;
}

function ensureRun(
	input: PiHookIngestInput,
	ledger: LedgerDatabase,
): { projectId: string; outcomeId: string; runId: string; prompt: string } | null {
	recordProject(
		{
			projectId: input.workspaceId,
			repoPath: input.repoPath ?? "",
		},
		ledger,
	);
	let identity = getRunWithOutcome(ledger, input.taskId);
	if (!identity) {
		if (getRun(ledger, input.taskId)) {
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
		identity = getRunWithOutcome(ledger, input.taskId);
	}
	if (!identity) {
		return null;
	}
	return {
		projectId: identity.outcome.projectId,
		outcomeId: identity.outcome.id,
		runId: identity.run.id,
		prompt: identity.run.prompt,
	};
}

function existingFingerprints(ledger: LedgerDatabase, outcomeId: string, runId: string): Set<string> {
	return new Set(
		listEvents(ledger, outcomeId)
			.filter((event) => event.runId === runId)
			.map((event) => eventFingerprint(event.kind, event.payload)),
	);
}

function appendMappedEvents(
	ledger: LedgerDatabase,
	identity: { projectId: string; outcomeId: string; runId: string },
	events: PiMappedTrailEvent[],
	seen: Set<string>,
): LedgerEventRecord[] {
	const written: LedgerEventRecord[] = [];
	for (const event of events) {
		const payload = scrubEventPayload({
			...event.payload,
			source: "pi",
		});
		const fingerprint = eventFingerprint(event.kind, payload);
		if (seen.has(fingerprint)) {
			continue;
		}
		seen.add(fingerprint);
		written.push(
			appendEvent(ledger, {
				projectId: identity.projectId,
				outcomeId: identity.outcomeId,
				runId: identity.runId,
				kind: event.kind,
				payload,
				createdAt: event.createdAt,
			}),
		);
	}
	return written;
}

function applyReportedStatus(
	ledger: LedgerDatabase,
	identity: { outcomeId: string; runId: string },
	events: PiMappedTrailEvent[],
): void {
	const statusEvent = [...events].reverse().find((event) => event.kind === "status");
	const status = typeof statusEvent?.payload.status === "string" ? statusEvent.payload.status : null;
	if (status !== "DONE" && status !== "DONE_WITH_CONCERNS" && status !== "NEEDS_CONTEXT" && status !== "BLOCKED") {
		return;
	}
	const reported = status as LedgerReportedStatus;
	const next = mapReportedStatusToRunState(reported);
	const endedAt = Date.now();
	updateRunStatus(ledger, identity.runId, {
		status: next.runStatus,
		endedAt,
		reportedStatus: reported,
	});
	updateOutcomeStatus(ledger, identity.outcomeId, next.outcomeStatus, endedAt);
}

function applyHookNotifyStatus(
	ledger: LedgerDatabase,
	identity: { outcomeId: string; runId: string },
	event: RuntimeHookEvent,
): void {
	const next = mapHookEventToLedgerStatuses(event);
	if (!next) {
		return;
	}
	const now = Date.now();
	updateRunStatus(ledger, identity.runId, {
		status: next.runStatus,
		startedAt: next.runStatus === "running" ? now : null,
		endedAt: next.runStatus === "running" ? null : now,
	});
	updateOutcomeStatus(ledger, identity.outcomeId, next.outcomeStatus, now);
}

export function recordPiWorkerHook(input: PiHookIngestInput): LedgerEventRecord[] {
	try {
		const ledger = input.ledger ?? openLedger();
		const identity = ensureRun(input, ledger);
		if (!identity) {
			return [];
		}
		const seen = existingFingerprints(ledger, identity.outcomeId, identity.runId);
		const mapped = mapPiHookActivityToLedger(input.event, input.metadata);
		const userPayload = scrubEventPayload({ text: identity.prompt, source: "pi" });
		if (identity.prompt.trim() && !seen.has(eventFingerprint("user_message", userPayload))) {
			mapped.unshift({
				kind: "user_message",
				payload: { text: identity.prompt, source: "pi" },
			});
		}
		const written = appendMappedEvents(ledger, identity, mapped, seen);
		if (mapped.some((event) => event.kind === "status")) {
			applyReportedStatus(ledger, identity, mapped);
		} else {
			applyHookNotifyStatus(ledger, identity, input.event);
		}
		return written;
	} catch (error) {
		warnPiIngestFailure("hook", error);
		return [];
	}
}

export async function ingestPiSessionJsonl(input: {
	taskId: string;
	workspaceId: string;
	repoPath?: string;
	sessionPath: string;
	ledger?: LedgerDatabase;
}): Promise<LedgerEventRecord[]> {
	try {
		const content = await readFile(input.sessionPath, "utf8");
		const mapped = mapPiSessionEntriesToLedger(parseSessionEntries(content));
		const ledger = input.ledger ?? openLedger();
		const identity = ensureRun(
			{
				taskId: input.taskId,
				workspaceId: input.workspaceId,
				repoPath: input.repoPath,
				event: "activity",
			},
			ledger,
		);
		if (!identity) {
			return [];
		}
		const seen = existingFingerprints(ledger, identity.outcomeId, identity.runId);
		const written = appendMappedEvents(ledger, identity, mapped, seen);
		applyReportedStatus(ledger, identity, mapped);
		return written;
	} catch (error) {
		warnPiIngestFailure("jsonl", error);
		return [];
	}
}
