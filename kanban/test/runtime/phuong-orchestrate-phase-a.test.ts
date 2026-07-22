import { describe, expect, it } from "vitest";
import {
	assemblePhuongSystemPrompt,
	getPhuongFallbackSystemPrompt,
} from "../../src/manager/phuong-context.js";
import {
	CREATE_CHAT_PROMPT_CONTRACT,
	createPhuongTools,
} from "../../src/manager/phuong-tools.js";
import type { BoardOperations } from "../../src/manager/phuong-tools.js";

const noopBoardOps: BoardOperations = {
	createCard: async () => ({ cardId: "test-card" }),
	listCards: async () => [],
	startTask: async () => ({ ok: true }),
	getSessionSummary: async () => null,
};

describe("Phuong Phase A orchestration protocol", () => {
	it("fallback system prompt includes scope gate, routing table, gate, triage, and retry budget", () => {
		const prompt = getPhuongFallbackSystemPrompt();

		expect(prompt).toContain("Scope gate");
		expect(prompt).toContain("routing table");
		expect(prompt).toContain("Done-criteria");
		expect(prompt).toContain("Gate 1");
		expect(prompt).toContain("spec");
		expect(prompt).toContain("environment");
		expect(prompt).toContain("capability");
		expect(prompt).toContain("Max **3** dispatches");
		expect(prompt).toContain("NEEDS_CONTEXT");
		expect(prompt).toContain("never implement code yourself");
		expect(prompt).toContain("Phuong");
		expect(prompt).toContain("model routing");
		expect(prompt).toContain("run_gate");
		expect(prompt).toContain("attach_artifact");
	});

	it("assemblePhuongSystemPrompt returns the fallback when memory is not configured", () => {
		expect(assemblePhuongSystemPrompt()).toBe(getPhuongFallbackSystemPrompt());
	});

	it("create_chat prompt parameter requires the unit contract sections", () => {
		const tools = createPhuongTools(noopBoardOps);
		const createChat = tools.find((t) => t.name === "create_chat");
		expect(createChat).toBeDefined();

		const promptSchema = (
			createChat!.parameters as {
				properties?: { prompt?: { description?: string } };
			}
		).properties?.prompt;
		const description = `${createChat!.description}\n${promptSchema?.description ?? ""}`;

		for (const section of CREATE_CHAT_PROMPT_CONTRACT) {
			expect(description.toLowerCase()).toContain(
				section === "STATUS marker reminder" ? "status:" : section.toLowerCase().split(" / ")[0]!,
			);
		}
		expect(description).toMatch(/done-criteria/i);
		expect(description).toMatch(/in-scope/i);
		expect(description).toMatch(/out-of-scope/i);
		expect(description).toMatch(/retry budget/i);
		expect(description).toMatch(/tier/i);
		expect(description).toMatch(/model/i);
	});

	it("create_chat accepts tier and model parameters", () => {
		const tools = createPhuongTools(noopBoardOps);
		const createChat = tools.find((t) => t.name === "create_chat");
		const properties = (
			createChat!.parameters as {
				properties?: Record<string, unknown>;
			}
		).properties;
		expect(properties?.tier).toBeDefined();
		expect(properties?.model).toBeDefined();
	});

	it("exposes run_gate and attach_artifact tools", () => {
		const tools = createPhuongTools(noopBoardOps);
		expect(tools.some((t) => t.name === "run_gate")).toBe(true);
		expect(tools.some((t) => t.name === "attach_artifact")).toBe(true);
		expect(tools.some((t) => t.name === "list_artifacts")).toBe(true);
	});

	it("check_chat_status description encodes Gate 1 and triage routing", () => {
		const tools = createPhuongTools(noopBoardOps);
		const check = tools.find((t) => t.name === "check_chat_status");
		expect(check?.description).toMatch(/Gate 1/i);
		expect(check?.description).toMatch(/spec \/ environment \/ capability/i);
		expect(check?.description).toMatch(/NEEDS_CONTEXT/i);
	});
});
