import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import {
	isMemoryConfigured,
	listProjects,
	listProjectMemories,
	loadSpecificMemories,
	loadProjectContext,
} from "../memory/memory-service.js";
import type { RuntimeTaskArtifact, RuntimeTaskTier } from "../core/api-contract.js";
import { resolveChatModel } from "./model-tier-routing.js";
import type { TaskAgentStatusReport } from "./task-status-protocol.js";

export interface BoardOperations {
	createCard: (
		prompt: string,
		baseRef?: string,
		options?: { model?: string; tier?: RuntimeTaskTier },
	) => Promise<{ cardId: string; model?: string; tier?: RuntimeTaskTier }>;
	listCards: () => Promise<
		{ id: string; prompt: string; column: string; sessionState?: string; model?: string; tier?: string }[]
	>;
	startTask: (taskId: string) => Promise<{ ok: boolean; error?: string }>;
	getSessionSummary: (taskId: string) => Promise<{
		state: string;
		exitCode: number | null;
		reviewReason: string | null;
		lastActivity: string | null;
		reportedStatus: TaskAgentStatusReport | null;
	} | null>;
	runGate?: (
		taskId: string,
		command: string,
	) => Promise<{ ok: boolean; exitCode: number | null; output: string; error?: string }>;
	attachArtifact?: (
		taskId: string,
		artifact: Omit<RuntimeTaskArtifact, "id" | "createdAt"> & { id?: string },
	) => Promise<{ ok: boolean; artifact?: RuntimeTaskArtifact; error?: string }>;
	listArtifacts?: (taskId: string) => Promise<RuntimeTaskArtifact[]>;
	recordCreatedChat?: (input: {
		cardId: string;
		prompt: string;
		model?: string;
		tier?: RuntimeTaskTier;
	}) => Promise<void>;
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
			"Create and start a new Pi agent chat for one work unit under the current project. The agent begins immediately in its own git worktree. " +
			"For substantive multi-unit work, announce the routing table in your reply before calling this tool. " +
			"One unit ≈ one chat. Do not use this for pure conversation. " +
			"Pass tier (T0–T3) or an explicit model so light work uses a cheaper model and complex work uses a stronger one. " +
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
			tier: Type.Optional(
				Type.Union(
					[Type.Literal("T0"), Type.Literal("T1"), Type.Literal("T2"), Type.Literal("T3")],
					{
						description:
							"Capability tier for model routing. T0=mechanical/cheap, T1=standard, T2=complex, T3=high-risk. " +
							"Maps to env PHUONG_MODEL_T0…T3 (defaults: T0/T1 lighter Kimi, T2/T3 Kimi K3).",
					},
				),
			),
			model: Type.Optional(
				Type.String({
					description:
						"Optional explicit Pi model id (e.g. kimi-coding/kimi-k3 or kimi-coding/kimi-k2.7). Overrides tier mapping when set.",
				}),
			),
		}),
		execute: async (_toolCallId, params) => {
			const { prompt, tier, model } = params as {
				prompt: string;
				tier?: RuntimeTaskTier;
				model?: string;
			};
			const resolvedModel = resolveChatModel({ model, tier });
			const result = await boardOps.createCard(prompt, undefined, {
				model: resolvedModel,
				tier,
			});
			await boardOps.recordCreatedChat?.({
				cardId: result.cardId,
				prompt,
				model: resolvedModel,
				tier,
			});
			const startResult = await boardOps.startTask(result.cardId);
			if (!startResult.ok) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Chat created (${result.cardId}) but failed to start: ${startResult.error}`,
						},
					],
					details: {},
				};
			}
			const modelNote = resolvedModel ? ` model=${resolvedModel}` : "";
			const tierNote = tier ? ` tier=${tier}` : "";
			return {
				content: [
					{
						type: "text" as const,
						text: `Chat created and started (${result.cardId}).${tierNote}${modelNote} The Pi agent is now working on it under this project. The user can watch it from the Dashboard (read-only) or stay in Phuong chat.`,
					},
				],
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
				const modelBit = c.model ? ` model=${c.model}` : "";
				const tierBit = c.tier ? ` tier=${c.tier}` : "";
				const preview = c.prompt ? c.prompt.slice(0, 120) + (c.prompt.length > 120 ? "..." : "") : "(no prompt)";
				return `- [${status}] (${c.id})${tierBit}${modelBit} ${preview}`;
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
					content: [
						{
							type: "text" as const,
							text: `No session found for chat ${chat_id}. It may not have been started yet.`,
						},
					],
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

	const runGateTool: ToolDefinition = {
		name: "run_gate",
		label: "Run Gate",
		description:
			"Run a Gate 1 command in a chat's worktree (tests, lint, build, or a screenshot/E2E script). " +
			"Use after a worker reports DONE before telling the user the unit shipped. " +
			"Prefer project conventions from memory context.md.",
		parameters: Type.Object({
			chat_id: Type.String({ description: "The chat/task ID whose worktree to use" }),
			command: Type.String({
				description: "Shell command to run in the chat worktree (e.g. npm test -- --run path)",
			}),
		}),
		execute: async (_toolCallId, params) => {
			const { chat_id, command } = params as { chat_id: string; command: string };
			if (!boardOps.runGate) {
				return {
					content: [
						{
							type: "text" as const,
							text: "run_gate is not available in this environment.",
						},
					],
					details: {},
				};
			}
			const result = await boardOps.runGate(chat_id, command);
			if (!result.ok && result.error) {
				return {
					content: [{ type: "text" as const, text: `Gate failed: ${result.error}` }],
					details: {},
				};
			}
			const status = result.exitCode === 0 ? "PASS" : "FAIL";
			return {
				content: [
					{
						type: "text" as const,
						text: `Gate ${status} (exit ${result.exitCode ?? "?"})\n\n${result.output.slice(0, 4000)}`,
					},
				],
				details: {},
			};
		},
	};

	const attachArtifactTool: ToolDefinition = {
		name: "attach_artifact",
		label: "Attach Artifact",
		description:
			"Attach an E2E screenshot or other artifact path from a chat worktree so the user can see it on the Dashboard (phone/desktop) without opening the worker terminal. " +
			"Path should be relative to the chat worktree (e.g. .phuong/artifacts/login.png).",
		parameters: Type.Object({
			chat_id: Type.String({ description: "Chat/task ID" }),
			path: Type.String({ description: "Path relative to the chat worktree" }),
			mime_type: Type.Optional(Type.String({ description: "MIME type, default image/png" })),
			label: Type.Optional(Type.String({ description: "Short label shown in the UI" })),
		}),
		execute: async (_toolCallId, params) => {
			const { chat_id, path, mime_type, label } = params as {
				chat_id: string;
				path: string;
				mime_type?: string;
				label?: string;
			};
			if (!boardOps.attachArtifact) {
				return {
					content: [{ type: "text" as const, text: "attach_artifact is not available." }],
					details: {},
				};
			}
			const result = await boardOps.attachArtifact(chat_id, {
				path,
				mimeType: mime_type?.trim() || "image/png",
				label,
			});
			if (!result.ok) {
				return {
					content: [{ type: "text" as const, text: `Could not attach artifact: ${result.error}` }],
					details: {},
				};
			}
			return {
				content: [
					{
						type: "text" as const,
						text: `Artifact attached to chat ${chat_id}: ${result.artifact?.label ?? result.artifact?.path}`,
					},
				],
				details: {},
			};
		},
	};

	const listArtifactsTool: ToolDefinition = {
		name: "list_artifacts",
		label: "List Artifacts",
		description: "List screenshots and other artifacts attached to a chat.",
		parameters: Type.Object({
			chat_id: Type.String({ description: "Chat/task ID" }),
		}),
		execute: async (_toolCallId, params) => {
			const { chat_id } = params as { chat_id: string };
			if (!boardOps.listArtifacts) {
				return {
					content: [{ type: "text" as const, text: "list_artifacts is not available." }],
					details: {},
				};
			}
			const artifacts = await boardOps.listArtifacts(chat_id);
			if (artifacts.length === 0) {
				return {
					content: [{ type: "text" as const, text: `No artifacts on chat ${chat_id}.` }],
					details: {},
				};
			}
			const lines = artifacts.map(
				(a) => `- ${a.label ?? a.path} (${a.mimeType}) path=${a.path}`,
			);
			return { content: [{ type: "text" as const, text: lines.join("\n") }], details: {} };
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
					content: [
						{
							type: "text" as const,
							text: `No matching memories found for project "${project}".`,
						},
					],
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
		description:
			"List available memory files for a project (filenames and summaries). Use this to decide which memories to load.",
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
					content: [
						{
							type: "text" as const,
							text: `No memories found for project "${project}".`,
						},
					],
					details: {},
				};
			}
			const lines = memories.map(
				(m) =>
					`- **${m.filename}**: ${m.summary}${m.tags.length > 0 ? ` [${m.tags.join(", ")}]` : ""}`,
			);
			return { content: [{ type: "text" as const, text: lines.join("\n") }], details: {} };
		},
	};

	return [
		createChatTool,
		listChatsTool,
		startChatTool,
		checkChatStatusTool,
		runGateTool,
		attachArtifactTool,
		listArtifactsTool,
		listProjectsTool,
		loadMemoryTool,
		listProjectMemoriesTool,
	];
}
