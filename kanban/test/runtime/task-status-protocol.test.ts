import { describe, expect, it } from "vitest";

import { parseTaskAgentStatus } from "../../src/manager/task-status-protocol.js";

describe("parseTaskAgentStatus", () => {
	it("returns null for null, undefined, and empty input", () => {
		expect(parseTaskAgentStatus(null)).toBeNull();
		expect(parseTaskAgentStatus(undefined)).toBeNull();
		expect(parseTaskAgentStatus("")).toBeNull();
	});

	it("parses each of the four valid statuses without a reason", () => {
		expect(parseTaskAgentStatus("All tests pass.\nSTATUS: DONE")).toEqual({
			status: "DONE",
			reason: null,
		});
		expect(parseTaskAgentStatus("Finished but unsure about edge case.\nSTATUS: DONE_WITH_CONCERNS")).toEqual({
			status: "DONE_WITH_CONCERNS",
			reason: null,
		});
		expect(parseTaskAgentStatus("Need more info.\nSTATUS: NEEDS_CONTEXT")).toEqual({
			status: "NEEDS_CONTEXT",
			reason: null,
		});
		expect(parseTaskAgentStatus("Cannot proceed.\nSTATUS: BLOCKED")).toEqual({
			status: "BLOCKED",
			reason: null,
		});
	});

	it("captures a single-line reason that follows the status marker", () => {
		const text = "Implementation complete and tested.\nSTATUS: DONE_WITH_CONCERNS\nREASON: Auth flow not exercised by tests";
		expect(parseTaskAgentStatus(text)).toEqual({
			status: "DONE_WITH_CONCERNS",
			reason: "Auth flow not exercised by tests",
		});
	});

	it("treats an empty REASON value as no reason", () => {
		expect(parseTaskAgentStatus("STATUS: DONE\nREASON:")).toEqual({
			status: "DONE",
			reason: null,
		});
		expect(parseTaskAgentStatus("STATUS: DONE\nREASON:    ")).toEqual({
			status: "DONE",
			reason: null,
		});
	});

	it("rejects unknown or lowercase statuses", () => {
		expect(parseTaskAgentStatus("STATUS: done")).toBeNull();
		expect(parseTaskAgentStatus("STATUS: COMPLETE")).toBeNull();
		expect(parseTaskAgentStatus("STATUS: DONE_TASK")).toBeNull();
	});

	it("ignores markers buried earlier in a long message", () => {
		const filler = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
		const text = `STATUS: DONE\n${filler}\nbut still working`;
		expect(parseTaskAgentStatus(text)).toBeNull();
	});

	it("matches the most recent status marker when several appear in the window", () => {
		const text = ["STATUS: BLOCKED", "actually wait", "STATUS: DONE"].join("\n");
		expect(parseTaskAgentStatus(text)).toEqual({
			status: "DONE",
			reason: null,
		});
	});

	it("requires the marker to be on its own line", () => {
		expect(parseTaskAgentStatus("Final summary STATUS: DONE in passing")).toBeNull();
	});

	it("ignores REASON lines that come before the status marker", () => {
		const text = "REASON: leftover from earlier\nSTATUS: DONE";
		expect(parseTaskAgentStatus(text)).toEqual({
			status: "DONE",
			reason: null,
		});
	});

	it("normalizes Windows line endings", () => {
		expect(parseTaskAgentStatus("STATUS: DONE\r\nREASON: ok")).toEqual({
			status: "DONE",
			reason: "ok",
		});
	});

	it("trims whitespace around STATUS lines", () => {
		expect(parseTaskAgentStatus("   STATUS: BLOCKED   \n  REASON:  cannot reach DB  ")).toEqual({
			status: "BLOCKED",
			reason: "cannot reach DB",
		});
	});
});
