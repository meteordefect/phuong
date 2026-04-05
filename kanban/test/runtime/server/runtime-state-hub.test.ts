import { describe, expect, it } from "vitest";

import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract.js";
import { didTaskEnterReviewFromTerminalExit } from "../../../src/server/runtime-state-hub.js";

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

describe("createRuntimeStateHub", () => {
	it("treats clean terminal exits as review-ready transitions", () => {
		const previousSummary = createSummary({ taskId: "task-pi", state: "running", reviewReason: null });
		const nextSummary = createSummary({
			taskId: "task-pi",
			state: "awaiting_review",
			reviewReason: "exit",
			exitCode: 0,
			pid: null,
		});

		expect(didTaskEnterReviewFromTerminalExit(previousSummary, nextSummary)).toBe(true);
	});

	it("does not treat interrupted sessions as review-ready exits", () => {
		const previousSummary = createSummary({ taskId: "task-pi", state: "running", reviewReason: null });
		const nextSummary = createSummary({
			taskId: "task-pi",
			state: "interrupted",
			reviewReason: "interrupted",
			exitCode: null,
			pid: null,
		});

		expect(didTaskEnterReviewFromTerminalExit(previousSummary, nextSummary)).toBe(false);
	});
});
