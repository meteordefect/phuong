import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import {
	isMemoryConfigured,
	listProjects,
	listProjectMemories,
	loadSpecificMemories,
	loadProjectContext,
} from "../memory/memory-service.js";
import type { TaskAgentStatusReport } from "./task-status-protocol.js";

export interface BoardOperations {
	createCard: (prompt: string, baseRef?: string) => Promise<{ cardId: string }>;
	listCards: () => Promise<{ id: string; prompt: string; column: string; sessionState?: string }[]>;
	startTask: (taskId: string) => Promise<{ ok: boolean; error?: string }>;
	getSessionSummary: (taskId: string) => Promise<{
		state: string;
		exitCode: number | null;
		reviewReason: string | null;
		lastActivity: string | null;
		reportedStatus: TaskAgentStatusReport | null;
	} | null>;
}

/** Required sections for every unit prompt passed to create_chat (Phase A contract). */
export const CREATE_CHAT_PROMPT_CONTRACT = [
	"Objective",
	"In-scope / out-of-scope",
	"Done-criteria",
	"Files / subsystems",
	"STATUS marker reminder",
] as const;

export function createPhuongTools(boardOps: BoardOperations): ToolDefinition[] {
	const createChatTool: ToolDefinition = {
		name: "create_chat",
		label: "Create Chat",
		description:
			"Create and start a new Pi agent chat for one work unit. The agent begins immediately in its own git worktree. " +
			"For substantive multi-unit work, announce the routing table in your reply before calling this tool. " +
			"One unit ≈ one chat. Do not use this for pure conversation. " +
			"Respect the per-unit retry budget (max 3 dispatches): never silently retry an identical prompt.",
		parameters: Type.Object({
			prompt: Type.String({
				description:
					"Unit instructions for the Pi coding agent. MUST include all of: " +
					"(1) Objective — what success looks like; " +
					"(2) In-scope / out-of-scope — hard boundaries; " +
					"(3) Done-criteria — preferably runnable commands or grep/file invariants the agent (and you) can check; " +
					"(4) Files / subsystems to touch; " +
					"(5) Reminder to end the final message with STATUS: <DONE|DONE_WITH_CONCERNS|NEEDS_CONTEXT|BLOCKED> and optional REASON:. " +
					"Do not send a bare task title.",
			}),
		}),
		execute: async (_toolCallId, params) => {
			const { prompt } = params as { prompt: string };
			const result = await boardOps.createCard(prompt);
			const startResult = await boardOps.startTask(result.cardId);
			if (!startResult.ok) {
				return {
					content: [{ type: "text" as const, text: `Chat created (${result.cardId}) but failed to start: ${startResult.error}` }],
					details: {},
				};
			}
			return {
				content: [{ type: "text" as const, text: `Chat created and started (${result.cardId}). The Pi agent is now working on it. The user can click into this chat from the sidebar to see progress.` }],
				details: {},
			};
		},
	};

	const listChatsTool: ToolDefinition = {
		name: "list_chats",
		label: "List Chats",
		description: "List all agent chat sessions for the current project with their status.",
		parameters: Type.Object({}),
		execute: async () => {
			const cards = await boardOps.listCards();
			if (cards.length === 0) {
				return { content: [{ type: "text" as const, text: "No agent chats yet." }], details: {} };
			}
			const lines = cards.map((c) => {
				const status = c.sessionState ?? c.column;
				const preview = c.prompt ? c.prompt.slice(0, 120) + (c.prompt.length > 120 ? "..." : "") : "(no prompt)";
				return `- [${status}] (${c.id}) ${preview}`;
			});
			return { content: [{ type: "text" as const, text: lines.join("\n") }], details: {} };
		},
	};

	const startChatTool: ToolDefinition = {
		name: "start_chat",
		label: "Start Chat",
		description:
			"Resume an idle or stopped agent chat session (same unit / same chat). " +
			"Use after NEEDS_CONTEXT once the missing info is provided, or to continue a stopped session. " +
			"Do not create a new chat for the same unit when resume will do. " +
			"Resuming does not count as a new dispatch against the retry budget unless you changed the unit prompt via a new create_chat.",
		parameters: Type.Object({
			chat_id: Type.String({ description: "The chat/task ID to start or resume" }),
		}),
		execute: async (_toolCallId, params) => {
			const { chat_id } = params as { chat_id: string };
			const result = await boardOps.startTask(chat_id);
			if (!result.ok) {
				return {
					content: [{ type: "text" as const, text: `Failed to start chat: ${result.error}` }],
					details: {},
				};
			}
			return {
				content: [{ type: "text" as const, text: `Chat ${chat_id} started. The Pi agent is now working on it.` }],
				details: {},
			};
		},
	};

	const checkChatStatusTool: ToolDefinition = {
		name: "check_chat_status",
		label: "Check Chat Status",
		description:
			"Check the current status of an agent chat session — running, completed, failed, or idle. " +
			"When the agent's last message includes a STATUS marker (DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT, BLOCKED), " +
			"`Reported status` is authoritative: DONE still needs Gate 1 / user confirmation before you declare success; " +
			"NEEDS_CONTEXT → resume in-place (do not new-chat the same unit); " +
			"BLOCKED → triage as spec / environment / capability under the retry budget; " +
			"DONE_WITH_CONCERNS → read the reason before shipping.",
		parameters: Type.Object({
			chat_id: Type.String({ description: "The chat/task ID to check" }),
		}),
		execute: async (_toolCallId, params) => {
			const { chat_id } = params as { chat_id: string };
			const summary = await boardOps.getSessionSummary(chat_id);
			if (!summary) {
				return {
					content: [{ type: "text" as const, text: `No session found for chat ${chat_id}. It may not have been started yet.` }],
					details: {},
				};
			}
			const parts = [`State: ${summary.state}`];
			if (summary.exitCode !== null) {
				parts.push(`Exit code: ${summary.exitCode}`);
			}
			if (summary.reviewReason) {
				parts.push(`Review reason: ${summary.reviewReason}`);
			}
			if (summary.lastActivity) {
				parts.push(`Last activity: ${summary.lastActivity}`);
			}
			if (summary.reportedStatus) {
				const reasonSuffix = summary.reportedStatus.reason
					? ` — ${summary.reportedStatus.reason}`
					: "";
				parts.push(`Reported status: ${summary.reportedStatus.status}${reasonSuffix}`);
			}
			return {
				content: [{ type: "text" as const, text: parts.join("\n") }],
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
		createChatTool,
		listChatsTool,
		startChatTool,
		checkChatStatusTool,
		listProjectsTool,
		loadMemoryTool,
		listProjectMemoriesTool,
	];
}
