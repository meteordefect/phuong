import { describe, expect, it, vi } from "vitest";
import { assemblePhuongSystemPrompt, getPhuongFallbackSystemPrompt } from "../../src/manager/phuong-context.js";
import type { BoardOperations } from "../../src/manager/phuong-tools.js";
import { CREATE_CHAT_PROMPT_CONTRACT, createPhuongTools } from "../../src/manager/phuong-tools.js";

const noopBoardOps: BoardOperations = {
	createCard: async () => ({ cardId: "test-card" }),
	createOutcome: async () => ({ outcomeId: "out-1", title: "Test outcome" }),
	spawnRun: async (outcomeId) => ({ ok: true, runId: "run-1", outcomeId }),
	listOutcomes: async () => [],
	listRuns: async () => [],
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
		expect(prompt).toContain("create_outcome");
		expect(prompt).toContain("spawn_run");
		expect(prompt).toContain("list_outcomes");
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

	it("create_chat dual-writes chat intent before start", async () => {
		const recordCreatedChat = vi.fn(async () => undefined);
		const createCard = vi.fn(async () => ({
			cardId: "chat-22",
			model: "kimi-coding/kimi-k2.7",
			tier: "T1" as const,
		}));
		const startTask = vi.fn(async () => ({ ok: true }));
		const tools = createPhuongTools({
			...noopBoardOps,
			createCard,
			startTask,
			recordCreatedChat,
		});
		const createChat = tools.find((t) => t.name === "create_chat");
		if (!createChat) {
			throw new Error("create_chat tool is missing.");
		}
		await createChat.execute(
			"tool-1",
			{
				prompt:
					"Objective: ship\nIn-scope / out-of-scope: ui\nDone-criteria: tests\nFiles / subsystems: app\nSTATUS: DONE",
				tier: "T1",
			},
			undefined,
			undefined,
			{} as never,
		);
		expect(createCard).toHaveBeenCalled();
		expect(recordCreatedChat).toHaveBeenCalledWith(
			expect.objectContaining({
				cardId: "chat-22",
				tier: "T1",
			}),
		);
		expect(startTask).toHaveBeenCalledWith("chat-22");
	});

	it("check_chat_status description encodes Gate 1 and triage routing", () => {
		const tools = createPhuongTools(noopBoardOps);
		const check = tools.find((t) => t.name === "check_chat_status");
		expect(check?.description).toMatch(/Gate 1/i);
		expect(check?.description).toMatch(/spec \/ environment \/ capability/i);
		expect(check?.description).toMatch(/NEEDS_CONTEXT/i);
	});
});

describe("Phase 4 outcome nouns", () => {
	it("exposes create_outcome, spawn_run, list_outcomes, list_runs and keeps list_chats", () => {
		const tools = createPhuongTools(noopBoardOps);
		expect(tools.some((t) => t.name === "create_outcome")).toBe(true);
		expect(tools.some((t) => t.name === "spawn_run")).toBe(true);
		expect(tools.some((t) => t.name === "list_outcomes")).toBe(true);
		expect(tools.some((t) => t.name === "list_runs")).toBe(true);
		expect(tools.some((t) => t.name === "create_chat")).toBe(true);
		expect(tools.some((t) => t.name === "list_chats")).toBe(true);
	});

	it("create_outcome description carries the prompt contract; spawn_run is the unit slice", () => {
		const tools = createPhuongTools(noopBoardOps);
		const createOutcome = tools.find((t) => t.name === "create_outcome");
		const spawnRun = tools.find((t) => t.name === "spawn_run");
		const descriptionSchema = (
			createOutcome!.parameters as {
				properties?: { description?: { description?: string } };
			}
		).properties?.description;
		const outcomeText = `${createOutcome!.description}\n${descriptionSchema?.description ?? ""}`;
		for (const section of CREATE_CHAT_PROMPT_CONTRACT) {
			expect(outcomeText.toLowerCase()).toContain(
				section === "STATUS marker reminder" ? "status:" : section.toLowerCase().split(" / ")[0]!,
			);
		}
		expect(spawnRun?.description).toMatch(/unit slice/i);
		expect(spawnRun?.description).toMatch(/outcome/i);
	});

	it("multi-unit request creates one outcome and N runs; list_chats still works", async () => {
		const createOutcome = vi.fn(async () => ({ outcomeId: "out-9", title: "Ship login" }));
		const spawnRun = vi.fn(async (outcomeId: string, prompt: string) => ({
			ok: true,
			runId: prompt.includes("U1") ? "run-a" : "run-b",
			outcomeId,
		}));
		const listCards = vi.fn(async () => [
			{ id: "run-a", prompt: "U1 auth", column: "in_progress" },
			{ id: "run-b", prompt: "U2 ui", column: "backlog" },
		]);
		const tools = createPhuongTools({
			...noopBoardOps,
			createOutcome,
			spawnRun,
			listCards,
		});
		const createOutcomeTool = tools.find((t) => t.name === "create_outcome");
		const spawnRunTool = tools.find((t) => t.name === "spawn_run");
		const listChatsTool = tools.find((t) => t.name === "list_chats");
		if (!createOutcomeTool || !spawnRunTool || !listChatsTool) {
			throw new Error("Phase 4 tools are missing.");
		}
		await createOutcomeTool.execute(
			"tool-out",
			{
				description:
					"Objective: ship login\nIn-scope / out-of-scope: auth\nDone-criteria: tests\nFiles / subsystems: app\nSTATUS: DONE",
			},
			undefined,
			undefined,
			{} as never,
		);
		await spawnRunTool.execute(
			"tool-u1",
			{ outcome_id: "out-9", prompt: "U1 auth slice", tier: "T1" },
			undefined,
			undefined,
			{} as never,
		);
		await spawnRunTool.execute(
			"tool-u2",
			{ outcome_id: "out-9", prompt: "U2 ui slice", tier: "T1" },
			undefined,
			undefined,
			{} as never,
		);
		expect(createOutcome).toHaveBeenCalledTimes(1);
		expect(spawnRun).toHaveBeenCalledTimes(2);
		expect(spawnRun).toHaveBeenNthCalledWith(1, "out-9", "U1 auth slice", expect.objectContaining({ tier: "T1" }));
		expect(spawnRun).toHaveBeenNthCalledWith(2, "out-9", "U2 ui slice", expect.objectContaining({ tier: "T1" }));

		const listed = await listChatsTool.execute("tool-list", {}, undefined, undefined, {} as never);
		const text = listed.content.map((part) => ("text" in part ? part.text : "")).join("\n");
		expect(text).toContain("run-a");
		expect(text).toContain("run-b");
	});
});
