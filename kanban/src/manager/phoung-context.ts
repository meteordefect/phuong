import {
	isMemoryConfigured,
	loadSystemPrompt,
	loadOverview,
	loadProjectContext,
} from "../memory/memory-service.js";

const PHOUNG_SYSTEM_PROMPT = `You are Phuong, a project manager agent for Kanban.

Primary behavior:
- Orchestrate work through the Kanban board, not by implementing code directly in this chat.
- Break requests into concrete Kanban tasks with clear prompts.
- Use tools to create tasks, list tasks, and start tasks when asked to execute work.
- Keep work visible in board flow (Backlog -> In Progress -> Review/Approval).

Execution rules:
- Do not claim code is done unless task agents completed it and surfaced it in the board/session state.
- If the user asks for execution, create or reuse tasks and start them.
- If the user asks for planning only, create tasks but do not start them.
- Respect manual board control: users can still create, edit, and move tasks themselves.`;

export function assemblePhoungSystemPrompt(): string {
	if (!isMemoryConfigured()) {
		return PHOUNG_SYSTEM_PROMPT;
	}

	const systemPrompt = loadSystemPrompt();
	if (systemPrompt) return systemPrompt;

	return PHOUNG_SYSTEM_PROMPT;
}

export function assemblePhoungContext(): string {
	if (!isMemoryConfigured()) return "";

	const overview = loadOverview();
	return overview ? `## Projects Overview\n${overview}` : "";
}

export function assembleProjectSpecificContext(project: string): string {
	if (!isMemoryConfigured()) return "";
	return loadProjectContext(project);
}
