import { describe, expect, it } from "vitest";

import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import { shouldSuppressTerminalDisconnectError } from "@/terminal/persistent-terminal-manager";

function createSummary(overrides: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state: "running",
		agentId: "pi",
		workspacePath: "/tmp/worktree",
		pid: 1234,
		startedAt: 1000,
		updatedAt: 2000,
		lastOutputAt: 2000,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		...overrides,
	};
}

describe("shouldSuppressTerminalDisconnectError", () => {
	it("suppresses generic disconnect errors after a task finishes", () => {
		const summary = createSummary({
			state: "awaiting_review",
			reviewReason: "exit",
			exitCode: 0,
			pid: null,
		});

		expect(
			shouldSuppressTerminalDisconnectError(
				summary,
				"Terminal control connection closed. Close and reopen to reconnect.",
			),
		).toBe(true);
	});

	it("does not suppress disconnect errors while a task is still running", () => {
		const summary = createSummary({
			state: "running",
			reviewReason: null,
		});

		expect(
			shouldSuppressTerminalDisconnectError(
				summary,
				"Terminal control connection closed. Close and reopen to reconnect.",
			),
		).toBe(false);
	});

	it("preserves specific failure messages after a task ends", () => {
		const summary = createSummary({
			state: "failed",
			reviewReason: "error",
			exitCode: 1,
			pid: null,
		});

		expect(shouldSuppressTerminalDisconnectError(summary, "pi exited with code 1")).toBe(false);
	});
});
