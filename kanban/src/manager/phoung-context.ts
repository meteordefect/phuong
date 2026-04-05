import {
	isMemoryConfigured,
	loadSystemPrompt,
	loadOverview,
	loadProjectContext,
} from "../memory/memory-service.js";

export function assemblePhoungSystemPrompt(): string {
	if (!isMemoryConfigured()) {
		return "You are Phoung, a project manager agent. You help plan work, create tasks, and manage the board.";
	}

	const systemPrompt = loadSystemPrompt();
	if (systemPrompt) return systemPrompt;

	return "You are Phoung, a project manager agent. You help plan work, create tasks, and manage the board.";
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
