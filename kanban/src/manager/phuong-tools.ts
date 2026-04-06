import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { randomUUID } from "node:crypto";
import {
	isMemoryConfigured,
	listProjects,
	listProjectMemories,
	loadSpecificMemories,
	loadProjectContext,
} from "../memory/memory-service.js";

export interface BoardOperations {
	createCard: (prompt: string, baseRef?: string) => Promise<{ cardId: string }>;
	listCards: () => Promise<{ id: string; prompt: string; column: string }[]>;
	startTask: (taskId: string) => Promise<{ ok: boolean; error?: string }>;
}

export function createPhuongTools(boardOps: BoardOperations): ToolDefinition[] {
	const createTaskTool: ToolDefinition = {
		name: "create_task",
		label: "Create Task",
		description:
			"Create a new task card on the Kanban board. The card will appear in the Backlog column. " +
			"Use this when the user asks you to plan, break down, or create work items.",
		parameters: Type.Object({
			prompt: Type.String({
				description: "Detailed task instructions for the coding agent that will execute this task",
			}),
		}),
		execute: async (_toolCallId, params) => {
			const { prompt } = params as { prompt: string };
			const result = await boardOps.createCard(prompt);
			return {
				content: [{ type: "text" as const, text: `Task created (${result.cardId}). It is now in the Backlog column.` }],
				details: {},
			};
		},
	};

	const listTasksTool: ToolDefinition = {
		name: "list_tasks",
		label: "List Tasks",
		description: "List all tasks on the Kanban board with their current column/status.",
		parameters: Type.Object({}),
		execute: async () => {
			const cards = await boardOps.listCards();
			if (cards.length === 0) {
				return { content: [{ type: "text" as const, text: "No tasks on the board." }], details: {} };
			}
			const lines = cards.map((c) => `- [${c.column}] ${c.prompt.slice(0, 120)}${c.prompt.length > 120 ? "..." : ""}`);
			return { content: [{ type: "text" as const, text: lines.join("\n") }], details: {} };
		},
	};

	const startTaskTool: ToolDefinition = {
		name: "start_task",
		label: "Start Task",
		description: "Start a task from the Backlog. The coding agent will pick it up and begin working.",
		parameters: Type.Object({
			task_id: Type.String({ description: "The task ID to start" }),
		}),
		execute: async (_toolCallId, params) => {
			const { task_id } = params as { task_id: string };
			const result = await boardOps.startTask(task_id);
			if (!result.ok) {
				return {
					content: [{ type: "text" as const, text: `Failed to start task: ${result.error}` }],
					details: {},
				};
			}
			return {
				content: [{ type: "text" as const, text: `Task ${task_id} started. The coding agent is now working on it.` }],
				details: {},
			};
		},
	};

	const listProjectsTool: ToolDefinition = {
		name: "list_projects",
		label: "List Projects",
		description: "List all known projects from memory.",
		parameters: Type.Object({}),
		execute: async () => {
			if (!isMemoryConfigured()) {
				return { content: [{ type: "text" as const, text: "Memory is not configured." }], details: {} };
			}
			const projects = listProjects();
			if (projects.length === 0) {
				return { content: [{ type: "text" as const, text: "No projects registered." }], details: {} };
			}
			const lines = projects.map((p) => {
				const ctx = loadProjectContext(p);
				const preview = ctx.slice(0, 100).replace(/\n/g, " ");
				return `- **${p}**: ${preview}`;
			});
			return { content: [{ type: "text" as const, text: lines.join("\n") }], details: {} };
		},
	};

	const loadMemoryTool: ToolDefinition = {
		name: "load_memory",
		label: "Load Memory",
		description:
			"Load specific memory files from a project. First use list_project_memories to see available files, " +
			"then load the ones you need.",
		parameters: Type.Object({
			project: Type.String({ description: "Project name" }),
			filenames: Type.Array(Type.String(), { description: "Memory filenames to load" }),
		}),
		execute: async (_toolCallId, params) => {
			const { project, filenames } = params as { project: string; filenames: string[] };
			if (!isMemoryConfigured()) {
				return { content: [{ type: "text" as const, text: "Memory is not configured." }], details: {} };
			}
			const memories = loadSpecificMemories(project, filenames);
			if (memories.length === 0) {
				return {
					content: [{ type: "text" as const, text: `No matching memories found for project "${project}".` }],
					details: {},
				};
			}
			const text = memories
				.map((m) => `### ${m.filename}\n${m.content}`)
				.join("\n\n---\n\n");
			return { content: [{ type: "text" as const, text }], details: {} };
		},
	};

	const listProjectMemoriesTool: ToolDefinition = {
		name: "list_project_memories",
		label: "List Project Memories",
		description: "List available memory files for a project (filenames and summaries). Use this to decide which memories to load.",
		parameters: Type.Object({
			project: Type.String({ description: "Project name" }),
		}),
		execute: async (_toolCallId, params) => {
			const { project } = params as { project: string };
			if (!isMemoryConfigured()) {
				return { content: [{ type: "text" as const, text: "Memory is not configured." }], details: {} };
			}
			const memories = listProjectMemories(project);
			if (memories.length === 0) {
				return {
					content: [{ type: "text" as const, text: `No memories found for project "${project}".` }],
					details: {},
				};
			}
			const lines = memories.map(
				(m) => `- **${m.filename}**: ${m.summary}${m.tags.length > 0 ? ` [${m.tags.join(", ")}]` : ""}`,
			);
			return { content: [{ type: "text" as const, text: lines.join("\n") }], details: {} };
		},
	};

	return [
		createTaskTool,
		listTasksTool,
		startTaskTool,
		listProjectsTool,
		loadMemoryTool,
		listProjectMemoriesTool,
	];
}
