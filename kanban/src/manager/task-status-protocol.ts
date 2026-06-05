export const TASK_AGENT_STATUSES = [
	"DONE",
	"DONE_WITH_CONCERNS",
	"NEEDS_CONTEXT",
	"BLOCKED",
] as const;

export type TaskAgentStatus = (typeof TASK_AGENT_STATUSES)[number];

export interface TaskAgentStatusReport {
	status: TaskAgentStatus;
	reason: string | null;
}

const STATUS_LINE = /^STATUS:[ \t]+([A-Z_]+)[ \t]*$/;
const REASON_LINE = /^REASON:[ \t]*(.*)$/;
const SCAN_WINDOW_LINES = 20;
const REASON_MAX_LENGTH = 280;

function isTaskAgentStatus(value: string): value is TaskAgentStatus {
	return (TASK_AGENT_STATUSES as readonly string[]).includes(value);
}

/**
 * Parse a task agent's final assistant message for the status marker defined in
 * `renderTaskAgentAppendSystemPrompt`. Returns null when no valid marker is found.
 *
 * The marker must appear within the last {@link SCAN_WINDOW_LINES} lines of the message
 * to avoid matching narrative prose. Anything beyond that window is ignored.
 */
export function parseTaskAgentStatus(text: string | null | undefined): TaskAgentStatusReport | null {
	if (!text) {
		return null;
	}

	const lines = text.replace(/\r\n/g, "\n").split("\n");
	const startIndex = Math.max(0, lines.length - SCAN_WINDOW_LINES);
	const window = lines.slice(startIndex);

	let statusIndex = -1;
	let status: TaskAgentStatus | null = null;
	for (let i = window.length - 1; i >= 0; i--) {
		const match = STATUS_LINE.exec(window[i]?.trim() ?? "");
		const captured = match?.[1];
		if (captured !== undefined && isTaskAgentStatus(captured)) {
			statusIndex = i;
			status = captured;
			break;
		}
	}

	if (status === null || statusIndex === -1) {
		return null;
	}

	let reason: string | null = null;
	for (let i = statusIndex + 1; i < window.length; i++) {
		const reasonMatch = REASON_LINE.exec(window[i]?.trim() ?? "");
		if (reasonMatch) {
			const value = (reasonMatch[1] ?? "").trim();
			reason = value.length > 0 ? value.slice(0, REASON_MAX_LENGTH) : null;
			break;
		}
	}

	return { status, reason };
}
