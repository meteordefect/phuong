import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { RuntimeBoardData } from "../../../src/core/api-contract.js";
import {
	appendEvent,
	closeAllLedgers,
	getDefaultLedgerPath,
	importWorkspacesFromBoard,
	listEvents,
	listOutcomes,
	listProjects,
	listRuns,
	mapPhuongSessionEventToLedger,
	openLedger,
	recordCreatedChatIntent,
	recordPhuongTrailEvent,
	recordRunSpawn,
	resetLedgerImportState,
	syncBoardCardsToLedger,
} from "../../../src/ledger/index.js";
import { loadWorkspaceContext, mutateWorkspaceState } from "../../../src/state/workspace-state.js";
import { createGitTestEnv } from "../../utilities/git-env.js";
import { createTempDir } from "../../utilities/temp-dir.js";

function createBoard(
	cards: Array<{ id: string; prompt: string; column: "backlog" | "in_progress" | "review" | "trash" }>,
): RuntimeBoardData {
	const columns: RuntimeBoardData["columns"] = [
		{ id: "backlog", title: "Backlog", cards: [] },
		{ id: "in_progress", title: "In Progress", cards: [] },
		{ id: "review", title: "Review", cards: [] },
		{ id: "trash", title: "Trash", cards: [] },
	];
	const now = Date.now();
	for (const card of cards) {
		const column = columns.find((item) => item.id === card.column);
		column?.cards.push({
			id: card.id,
			prompt: card.prompt,
			startInPlanMode: false,
			baseRef: "main",
			createdAt: now,
			updatedAt: now,
		});
	}
	return { columns, dependencies: [] };
}

async function withTemporaryHome<T>(run: () => Promise<T>): Promise<T> {
	const { path: tempHome, cleanup } = createTempDir("kanban-ledger-home-");
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	process.env.HOME = tempHome;
	process.env.USERPROFILE = tempHome;
	try {
		return await run();
	} finally {
		closeAllLedgers();
		resetLedgerImportState();
		if (previousHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previousHome;
		}
		if (previousUserProfile === undefined) {
			delete process.env.USERPROFILE;
		} else {
			process.env.USERPROFILE = previousUserProfile;
		}
		cleanup();
	}
}

function initGitRepository(path: string): void {
	const init = spawnSync("git", ["init"], {
		cwd: path,
		stdio: "ignore",
		env: createGitTestEnv(),
	});
	if (init.status !== 0) {
		throw new Error(`Failed to initialize git repository at ${path}`);
	}
	writeFileSync(join(path, "README.md"), "test\n");
	spawnSync("git", ["add", "."], { cwd: path, stdio: "ignore", env: createGitTestEnv() });
	spawnSync("git", ["commit", "-m", "init"], { cwd: path, stdio: "ignore", env: createGitTestEnv() });
}

afterEach(() => {
	closeAllLedgers();
	resetLedgerImportState();
});

describe("Phase 2 ledger", () => {
	it("creates schema and appends a spawn event", () => {
		const { path, cleanup } = createTempDir("kanban-ledger-");
		try {
			const ledger = openLedger(join(path, "ledger.sqlite"));
			expect(getDefaultLedgerPath()).toContain("ledger.sqlite");

			const project = listProjects(ledger);
			expect(project).toEqual([]);

			syncBoardCardsToLedger({
				projectId: "demo",
				repoPath: "/tmp/demo",
				board: createBoard([{ id: "chat-1", prompt: "Ship login", column: "backlog" }]),
				ledger,
			});

			expect(listProjects(ledger)).toEqual([
				expect.objectContaining({
					id: "demo",
					name: "demo",
					repoPath: "/tmp/demo",
				}),
			]);
			expect(listOutcomes(ledger, "demo")).toEqual([
				expect.objectContaining({
					id: "chat-1",
					title: "Ship login",
					status: "open",
				}),
			]);
			expect(listRuns(ledger, "chat-1")).toEqual([
				expect.objectContaining({
					id: "chat-1",
					status: "queued",
					agent: "pi",
					role: "worker",
				}),
			]);
			expect(listEvents(ledger, "chat-1")).toEqual([]);

			const event = appendEvent(ledger, {
				projectId: "demo",
				outcomeId: "chat-1",
				runId: "chat-1",
				kind: "spawn",
				payload: { agent: "pi", taskId: "chat-1" },
			});
			expect(event.kind).toBe("spawn");
			expect(event.payload).toEqual({ agent: "pi", taskId: "chat-1" });
			expect(listEvents(ledger, "chat-1")).toHaveLength(1);
		} finally {
			cleanup();
		}
	});

	it("does not invent a tool trail when importing board cards", () => {
		const { path, cleanup } = createTempDir("kanban-ledger-");
		try {
			const ledger = openLedger(join(path, "ledger.sqlite"));
			syncBoardCardsToLedger({
				projectId: "proj",
				repoPath: "/repos/proj",
				board: createBoard([
					{ id: "a", prompt: "First", column: "backlog" },
					{ id: "b", prompt: "Second", column: "in_progress" },
				]),
				sessions: {
					b: { state: "idle", startedAt: null, workspacePath: null },
				},
				ledger,
			});
			expect(listOutcomes(ledger, "proj")).toHaveLength(2);
			expect(listRuns(ledger, "a")[0]?.status).toBe("queued");
			expect(listRuns(ledger, "b")[0]?.status).toBe("queued");
			expect(listEvents(ledger, "a")).toEqual([]);
			expect(listEvents(ledger, "b")).toEqual([]);
		} finally {
			cleanup();
		}
	});

	it("is idempotent when the same card is synced twice", () => {
		const { path, cleanup } = createTempDir("kanban-ledger-");
		try {
			const ledger = openLedger(join(path, "ledger.sqlite"));
			const board = createBoard([{ id: "chat-1", prompt: "Ship login", column: "backlog" }]);
			syncBoardCardsToLedger({ projectId: "demo", repoPath: "/tmp/demo", board, ledger });
			syncBoardCardsToLedger({ projectId: "demo", repoPath: "/tmp/demo", board, ledger });
			expect(listOutcomes(ledger, "demo")).toHaveLength(1);
			expect(listRuns(ledger, "chat-1")).toHaveLength(1);
		} finally {
			cleanup();
		}
	});

	it("records a spawn event without inventing extra trail kinds", async () => {
		await withTemporaryHome(async () => {
			recordCreatedChatIntent({
				projectId: "demo",
				repoPath: "/tmp/demo",
				cardId: "chat-1",
				prompt: "Ship login",
				tier: "T1",
				model: "kimi-coding/kimi-k2.7",
			});
			const event = recordRunSpawn({
				taskId: "chat-1",
				workspaceId: "demo",
				agent: "pi",
				model: "kimi-coding/kimi-k2.7",
				prompt: "Ship login",
				worktreePath: "/tmp/worktree",
			});
			expect(event?.kind).toBe("spawn");
			const ledger = openLedger();
			expect(listRuns(ledger, "chat-1")[0]?.status).toBe("running");
			expect(listOutcomes(ledger, "demo")[0]?.status).toBe("in_progress");
			expect(listEvents(ledger, "chat-1").map((item) => item.kind)).toEqual(["spawn"]);
		});
	});
});

describe("Phase 2 ledger dual-write from board mutations", () => {
	it("writes project, outcome, and run when a card is persisted", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-ledger-workspace-");
			try {
				const workspacePath = join(sandboxRoot, "shop");
				mkdirSync(workspacePath, { recursive: true });
				initGitRepository(workspacePath);
				const context = await loadWorkspaceContext(workspacePath);
				await mutateWorkspaceState(workspacePath, (state) => {
					const board = structuredClone(state.board);
					const backlog = board.columns.find((column) => column.id === "backlog");
					backlog?.cards.unshift({
						id: "chat-9",
						prompt: "Add checkout",
						startInPlanMode: false,
						baseRef: "main",
						tier: "T1",
						model: "kimi-coding/kimi-k2.7",
						createdAt: Date.now(),
						updatedAt: Date.now(),
					});
					return { board, save: true, value: "chat-9" };
				});

				const ledger = openLedger(getDefaultLedgerPath());
				expect(getDefaultLedgerPath()).toBe(join(process.env.HOME ?? "", ".cline", "kanban", "ledger.sqlite"));
				expect(listProjects(ledger).some((project) => project.id === context.workspaceId)).toBe(true);
				expect(listOutcomes(ledger, context.workspaceId)).toEqual([
					expect.objectContaining({
						id: "chat-9",
						title: "Add checkout",
						status: "open",
					}),
				]);
				expect(listRuns(ledger, "chat-9")).toEqual([
					expect.objectContaining({
						id: "chat-9",
						status: "queued",
						agent: "pi",
					}),
				]);
				expect(listEvents(ledger, "chat-9")).toEqual([]);
			} finally {
				cleanup();
			}
		});
	});

	it("imports existing workspace cards on first ledger open", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-ledger-import-");
			try {
				const workspacePath = join(sandboxRoot, "shop");
				mkdirSync(workspacePath, { recursive: true });
				initGitRepository(workspacePath);
				const context = await loadWorkspaceContext(workspacePath);
				await mutateWorkspaceState(workspacePath, (state) => {
					const board = structuredClone(state.board);
					const backlog = board.columns.find((column) => column.id === "backlog");
					backlog?.cards.unshift({
						id: "legacy-1",
						prompt: "Legacy chat",
						startInPlanMode: false,
						baseRef: "main",
						createdAt: Date.now(),
						updatedAt: Date.now(),
					});
					return { board, save: true, value: "legacy-1" };
				});
				closeAllLedgers();
				resetLedgerImportState();

				const imported = await importWorkspacesFromBoard();
				expect(imported.projects).toBeGreaterThanOrEqual(1);
				const ledger = openLedger();
				expect(listOutcomes(ledger, context.workspaceId).some((outcome) => outcome.id === "legacy-1")).toBe(true);
			} finally {
				cleanup();
			}
		});
	});
});

describe("Phase 3.1 Phuong trail events", () => {
	it("maps SDK session events to message/tool/system kinds", () => {
		expect(mapPhuongSessionEventToLedger({ type: "turn_start" })).toBeNull();
		expect(mapPhuongSessionEventToLedger({ type: "text_delta" })).toBeNull();
		expect(
			mapPhuongSessionEventToLedger({
				type: "tool_execution_start",
				toolCallId: "call-1",
				toolName: "create_chat",
				args: { prompt: "Ship login" },
			}),
		).toEqual({
			kind: "tool_call",
			payload: {
				toolCallId: "call-1",
				name: "create_chat",
				args: { prompt: "Ship login" },
			},
		});
		expect(
			mapPhuongSessionEventToLedger({
				type: "tool_execution_end",
				toolCallId: "call-1",
				toolName: "create_chat",
				result: "created chat-1",
				isError: false,
			}),
		).toEqual({
			kind: "tool_result",
			payload: {
				toolCallId: "call-1",
				name: "create_chat",
				result: "created chat-1",
				isError: false,
			},
		});
		expect(
			mapPhuongSessionEventToLedger({
				type: "compaction_start",
				reason: "overflow",
			}),
		).toEqual({
			kind: "system",
			payload: { type: "compaction_start", reason: "overflow" },
		});
		expect(
			mapPhuongSessionEventToLedger({
				type: "message_update",
				assistantMessageEvent: {
					type: "error",
					error: { errorMessage: "sk-ant-abcdefghijklmnopqrstuvwxyz0123" },
					reason: "rate_limit",
				},
			})?.kind,
		).toBe("system");
	});

	it("appends Phuong events with run_id null and scrubs credentials", async () => {
		await withTemporaryHome(async () => {
			const userEvent = recordPhuongTrailEvent({
				projectId: "demo",
				repoPath: "/tmp/demo",
				conversationId: "conv-1",
				kind: "user_message",
				payload: { text: "Use sk-ant-abcdefghijklmnopqrstuvwxyz0123" },
			});
			expect(userEvent?.runId).toBeNull();
			expect(userEvent?.kind).toBe("user_message");
			expect(userEvent?.payload.text).toBe("Use [REDACTED]");
			expect(userEvent?.payload.source).toBe("phuong");

			const toolEvent = recordPhuongTrailEvent({
				projectId: "demo",
				repoPath: "/tmp/demo",
				conversationId: "conv-1",
				kind: "tool_call",
				payload: {
					name: "create_chat",
					args: { token: "ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD" },
				},
			});
			expect(toolEvent?.runId).toBeNull();
			expect(toolEvent?.payload.args).toEqual({ token: "[REDACTED]" });

			const ledger = openLedger();
			expect(listRuns(ledger, "conv-1")).toEqual([]);
			expect(listEvents(ledger, "conv-1").map((item) => item.kind)).toEqual(["user_message", "tool_call"]);
			expect(listEvents(ledger, "conv-1").every((item) => item.runId === null)).toBe(true);
			expect(listOutcomes(ledger, "demo")).toEqual([
				expect.objectContaining({
					id: "conv-1",
					title: "Use [REDACTED]",
					status: "in_progress",
				}),
			]);
		});
	});
});
