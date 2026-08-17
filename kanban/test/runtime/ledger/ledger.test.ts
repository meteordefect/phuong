import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
	runtimeAgentRunSchema,
	runtimeOutcomeSchema,
	runtimeStateStreamLedgerEventsMessageSchema,
	type RuntimeBoardData,
} from "../../../src/core/api-contract.js";
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
	mapPiHookActivityToLedger,
	mapPiSessionEntriesToLedger,
	onLedgerEventAppended,
	openLedger,
	recordArtifactEvent,
	recordCreatedChatIntent,
	recordCreatedOutcome,
	recordGateEvent,
	recordPhuongTrailEvent,
	recordPiWorkerHook,
	recordRunSpawn,
	recordSpawnedRun,
	resetLedgerEventListeners,
	resetLedgerImportState,
	syncBoardCardsToLedger,
} from "../../../src/ledger/index.js";
import { loadWorkspaceContext, mutateWorkspaceState } from "../../../src/state/workspace-state.js";
import { createGitTestEnv } from "../../utilities/git-env.js";
import { createTempDir } from "../../utilities/temp-dir.js";

const BOARD_IMPORT_FIXTURE_PATH = join(
	dirname(fileURLToPath(import.meta.url)),
	"../../fixtures/board-import/board.json",
);

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
		resetLedgerEventListeners();
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
	resetLedgerEventListeners();
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

	it("imports a snapshot board.json fixture workspace", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-ledger-fixture-");
			try {
				const workspacePath = join(sandboxRoot, "shop");
				mkdirSync(workspacePath, { recursive: true });
				initGitRepository(workspacePath);
				const context = await loadWorkspaceContext(workspacePath);
				const fixtureBoard = JSON.parse(readFileSync(BOARD_IMPORT_FIXTURE_PATH, "utf8")) as RuntimeBoardData;
				await mutateWorkspaceState(workspacePath, () => ({
					board: fixtureBoard,
					save: true,
					value: fixtureBoard.columns[0]?.cards[0]?.id ?? null,
				}));
				closeAllLedgers();
				resetLedgerImportState();

				const imported = await importWorkspacesFromBoard();
				expect(imported.projects).toBeGreaterThanOrEqual(1);
				const ledger = openLedger();
				expect(listOutcomes(ledger, context.workspaceId)).toEqual([
					expect.objectContaining({
						id: "fixture-1",
						title: "Snapshot imported chat",
						status: "open",
					}),
				]);
				expect(listRuns(ledger, "fixture-1")).toEqual([
					expect.objectContaining({
						id: "fixture-1",
						status: "queued",
					}),
				]);
				expect(fixtureBoard.columns[0]?.cards[0]?.id).toBe("fixture-1");
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
			expect(listEvents(ledger, "conv-1").map((item) => item.kind).sort()).toEqual(
				["tool_call", "user_message"],
			);
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

describe("Phase 3.2 Pi worker trail events", () => {
	it("maps hook metadata to tool and status events", () => {
		expect(
			mapPiHookActivityToLedger("activity", {
				source: "pi",
				hookEventName: "tool_call",
				toolName: "bash",
				activityText: '{"command":"npm test"}',
			}),
		).toEqual([
			{
				kind: "tool_call",
				payload: {
					name: "bash",
					args: '{"command":"npm test"}',
					source: "pi",
				},
			},
		]);
		expect(
			mapPiHookActivityToLedger("to_review", {
				source: "pi",
				hookEventName: "agent_end",
				finalMessage: "Implementation complete.\nSTATUS: DONE\nREASON: tests pass",
			}),
		).toEqual([
			{
				kind: "status",
				payload: {
					status: "DONE",
					reason: "tests pass",
					source: "pi",
				},
			},
		]);
	});

	it("maps session JSONL entries to messages and tools", () => {
		const mapped = mapPiSessionEntriesToLedger([
			{
				type: "message",
				timestamp: "2026-01-01T00:00:00.000Z",
				message: { role: "user", content: "Ship login" },
			},
			{
				type: "message",
				timestamp: "2026-01-01T00:00:01.000Z",
				message: {
					role: "assistant",
					content: [
						{ type: "text", text: "Editing auth.\nSTATUS: DONE" },
						{ type: "toolCall", id: "call-1", name: "edit", arguments: { path: "src/auth.ts" } },
					],
				},
			},
			{
				type: "message",
				timestamp: "2026-01-01T00:00:02.000Z",
				message: {
					role: "toolResult",
					toolCallId: "call-1",
					toolName: "edit",
					content: [{ type: "text", text: "ok" }],
					isError: false,
				},
			},
		]);
		expect(mapped.map((item) => item.kind)).toEqual([
			"user_message",
			"assistant_message",
			"tool_call",
			"status",
			"tool_result",
		]);
		expect(mapped[3]).toEqual(
			expect.objectContaining({
				kind: "status",
				payload: expect.objectContaining({ status: "DONE" }),
			}),
		);
	});

	it("appends Pi events with run_id, scrubs credentials, and stores STATUS", async () => {
		await withTemporaryHome(async () => {
			recordCreatedChatIntent({
				projectId: "demo",
				repoPath: "/tmp/demo",
				cardId: "run-1",
				prompt: "Ship login with ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD",
			});
			const toolEvents = recordPiWorkerHook({
				taskId: "run-1",
				workspaceId: "demo",
				repoPath: "/tmp/demo",
				event: "activity",
				metadata: {
					source: "pi",
					hookEventName: "tool_call",
					toolName: "bash",
					activityText: "sk-ant-abcdefghijklmnopqrstuvwxyz0123",
				},
			});
			expect(toolEvents.some((event) => event.kind === "user_message")).toBe(true);
			expect(toolEvents.some((event) => event.kind === "tool_call")).toBe(true);
			expect(toolEvents.every((event) => event.runId === "run-1")).toBe(true);
			expect(toolEvents.find((event) => event.kind === "tool_call")?.payload.args).toBe("[REDACTED]");

			recordPiWorkerHook({
				taskId: "run-1",
				workspaceId: "demo",
				repoPath: "/tmp/demo",
				event: "to_review",
				metadata: {
					source: "pi",
					hookEventName: "agent_end",
					finalMessage: "Done.\nSTATUS: DONE_WITH_CONCERNS\nREASON: no e2e",
				},
			});

			const ledger = openLedger();
			const run = listRuns(ledger, "run-1")[0];
			expect(run?.reportedStatus).toBe("DONE_WITH_CONCERNS");
			expect(run?.status).toBe("done");
			expect(listOutcomes(ledger, "demo")[0]?.status).toBe("verifying");
			expect(listEvents(ledger, "run-1").some((event) => event.kind === "status")).toBe(true);
			expect(listEvents(ledger, "run-1").every((event) => event.runId === "run-1")).toBe(true);
		});
	});
});

describe("Phase 3.3 gate and artifact events", () => {
	it("writes gate and artifact events keyed by run_id and outcome_id and scrubs credentials", async () => {
		await withTemporaryHome(async () => {
			recordCreatedChatIntent({
				projectId: "demo",
				repoPath: "/tmp/demo",
				cardId: "run-1",
				prompt: "Ship login",
			});
			const gate = recordGateEvent({
				taskId: "run-1",
				workspaceId: "demo",
				repoPath: "/tmp/demo",
				command: "npm test",
				exitCode: 0,
				output: "ok sk-ant-abcdefghijklmnopqrstuvwxyz0123",
			});
			expect(gate?.kind).toBe("gate");
			expect(gate?.runId).toBe("run-1");
			expect(gate?.outcomeId).toBe("run-1");
			expect(gate?.payload).toEqual(
				expect.objectContaining({
					command: "npm test",
					exitCode: 0,
					passed: true,
					output: "ok [REDACTED]",
					source: "phuong",
				}),
			);

			const artifact = recordArtifactEvent({
				taskId: "run-1",
				workspaceId: "demo",
				repoPath: "/tmp/demo",
				artifact: {
					id: "art-1",
					path: ".phuong/artifacts/login.png",
					mimeType: "image/png",
					label: "login",
				},
			});
			expect(artifact?.kind).toBe("artifact");
			expect(artifact?.runId).toBe("run-1");
			expect(artifact?.outcomeId).toBe("run-1");
			expect(artifact?.payload).toEqual(
				expect.objectContaining({
					id: "art-1",
					path: ".phuong/artifacts/login.png",
					mimeType: "image/png",
					label: "login",
					source: "phuong",
				}),
			);

			const ledger = openLedger();
			expect(listEvents(ledger, "run-1").map((event) => event.kind).sort()).toEqual(["artifact", "gate"]);
			expect(listEvents(ledger, "run-1").every((event) => event.runId === "run-1")).toBe(true);
		});
	});
});

describe("Phase 3.4 live ledger stream", () => {
	it("notifies listeners when an event is appended", () => {
		const { path, cleanup } = createTempDir("kanban-ledger-stream-");
		try {
			const seen: string[] = [];
			const unsubscribe = onLedgerEventAppended((event) => {
				seen.push(event.kind);
			});
			const ledger = openLedger(join(path, "ledger.sqlite"));
			syncBoardCardsToLedger({
				projectId: "demo",
				repoPath: "/tmp/demo",
				board: createBoard([{ id: "chat-1", prompt: "Ship login", column: "backlog" }]),
				ledger,
			});
			appendEvent(ledger, {
				projectId: "demo",
				outcomeId: "chat-1",
				runId: "chat-1",
				kind: "spawn",
				payload: { agent: "pi" },
			});
			expect(seen).toEqual(["spawn"]);
			unsubscribe();
			expect(
				runtimeStateStreamLedgerEventsMessageSchema.parse({
					type: "ledger_events_appended",
					workspaceId: "demo",
					events: [
						{
							id: "evt-1",
							projectId: "demo",
							outcomeId: "chat-1",
							runId: "chat-1",
							kind: "spawn",
							payload: { agent: "pi" },
							createdAt: 1,
						},
					],
				}).type,
			).toBe("ledger_events_appended");
		} finally {
			cleanup();
		}
	});
});

describe("Phase 3.5 inspectable trail", () => {
	it("records one Phuong turn and one pi run as inspectable events", async () => {
		await withTemporaryHome(async () => {
			recordPhuongTrailEvent({
				projectId: "demo",
				repoPath: "/tmp/demo",
				conversationId: "phuong-1",
				kind: "user_message",
				payload: { text: "Ship login" },
			});
			recordPhuongTrailEvent({
				projectId: "demo",
				repoPath: "/tmp/demo",
				conversationId: "phuong-1",
				kind: "tool_call",
				payload: { name: "create_chat", args: { prompt: "Ship login" } },
			});

			recordCreatedChatIntent({
				projectId: "demo",
				repoPath: "/tmp/demo",
				cardId: "run-1",
				prompt: "Ship login",
			});
			const spawn = recordRunSpawn({
				taskId: "run-1",
				workspaceId: "demo",
				agent: "pi",
				prompt: "Ship login",
			});
			expect(spawn?.kind).toBe("spawn");
			recordPiWorkerHook({
				taskId: "run-1",
				workspaceId: "demo",
				repoPath: "/tmp/demo",
				event: "activity",
				metadata: {
					source: "pi",
					hookEventName: "tool_call",
					toolName: "edit",
					activityText: "src/auth.ts",
				},
			});
			recordPiWorkerHook({
				taskId: "run-1",
				workspaceId: "demo",
				repoPath: "/tmp/demo",
				event: "to_review",
				metadata: {
					source: "pi",
					hookEventName: "agent_end",
					finalMessage: "Done.\nSTATUS: DONE",
				},
			});
			recordGateEvent({
				taskId: "run-1",
				workspaceId: "demo",
				command: "npm test",
				exitCode: 0,
				output: "pass",
			});
			recordArtifactEvent({
				taskId: "run-1",
				workspaceId: "demo",
				artifact: {
					id: "art-1",
					path: ".phuong/artifacts/login.png",
					mimeType: "image/png",
				},
			});

			const ledger = openLedger();
			const phuongKinds = listEvents(ledger, "phuong-1").map((event) => event.kind);
			expect(phuongKinds).toEqual(["user_message", "tool_call"]);
			expect(listEvents(ledger, "phuong-1").every((event) => event.runId === null)).toBe(true);

			const runKinds = listEvents(ledger, "run-1").map((event) => event.kind);
			expect(runKinds).toContain("spawn");
			expect(runKinds).toContain("user_message");
			expect(runKinds).toContain("tool_call");
			expect(runKinds).toContain("status");
			expect(runKinds).toContain("gate");
			expect(runKinds).toContain("artifact");
			expect(listEvents(ledger, "run-1").every((event) => event.runId === "run-1")).toBe(true);
			expect(listRuns(ledger, "run-1")[0]?.reportedStatus).toBe("DONE");
		});
	});
});

describe("Phase 4 outcome is the unit", () => {
	it("parses outcome and run contract types", () => {
		expect(
			runtimeOutcomeSchema.parse({
				id: "out-1",
				projectId: "demo",
				title: "Ship login",
				description: "Objective: ship login",
				status: "open",
				createdAt: 1,
				updatedAt: 1,
			}).id,
		).toBe("out-1");
		expect(
			runtimeAgentRunSchema.parse({
				id: "run-1",
				outcomeId: "out-1",
				role: "worker",
				agent: "pi",
				tier: "T1",
				model: "kimi-coding/kimi-k2.7",
				prompt: "U1 auth",
				worktreePath: null,
				piSessionPath: null,
				status: "queued",
				reportedStatus: null,
				createdAt: 1,
				startedAt: null,
				endedAt: null,
			}).outcomeId,
		).toBe("out-1");
	});

	it("creates one outcome and N runs with split ids", async () => {
		await withTemporaryHome(async () => {
			const outcome = recordCreatedOutcome({
				projectId: "demo",
				repoPath: "/tmp/demo",
				outcomeId: "out-1",
				title: "Ship login",
				description: "Objective: ship login\nDone-criteria: tests",
			});
			expect(outcome?.id).toBe("out-1");
			const runA = recordSpawnedRun({
				projectId: "demo",
				repoPath: "/tmp/demo",
				outcomeId: "out-1",
				runId: "run-a",
				prompt: "U1 auth slice",
				tier: "T1",
			});
			const runB = recordSpawnedRun({
				projectId: "demo",
				repoPath: "/tmp/demo",
				outcomeId: "out-1",
				runId: "run-b",
				prompt: "U2 ui slice",
				tier: "T1",
			});
			expect(runA?.outcomeId).toBe("out-1");
			expect(runB?.outcomeId).toBe("out-1");

			const ledger = openLedger();
			expect(listOutcomes(ledger, "demo")).toHaveLength(1);
			expect(listRuns(ledger, "out-1").map((run) => run.id)).toEqual(["run-a", "run-b"]);
			expect(listOutcomes(ledger, "demo").some((item) => item.id === "run-a")).toBe(false);
		});
	});

	it("hook notify updates outcome/run status without inventing a sibling outcome", async () => {
		await withTemporaryHome(async () => {
			recordCreatedOutcome({
				projectId: "demo",
				repoPath: "/tmp/demo",
				outcomeId: "out-1",
				title: "Ship login",
				description: "Ship login",
			});
			recordSpawnedRun({
				projectId: "demo",
				repoPath: "/tmp/demo",
				outcomeId: "out-1",
				runId: "run-a",
				prompt: "U1 auth slice",
			});

			recordPiWorkerHook({
				taskId: "run-a",
				workspaceId: "demo",
				repoPath: "/tmp/demo",
				event: "to_in_progress",
			});
			let ledger = openLedger();
			expect(listRuns(ledger, "out-1")[0]?.status).toBe("running");
			expect(listOutcomes(ledger, "demo")[0]?.status).toBe("in_progress");
			expect(listOutcomes(ledger, "demo")).toHaveLength(1);

			recordPiWorkerHook({
				taskId: "run-a",
				workspaceId: "demo",
				repoPath: "/tmp/demo",
				event: "to_review",
			});
			ledger = openLedger();
			expect(listRuns(ledger, "out-1")[0]?.status).toBe("done");
			expect(listOutcomes(ledger, "demo")[0]?.status).toBe("verifying");
			expect(listOutcomes(ledger, "demo").map((item) => item.id)).toEqual(["out-1"]);
		});
	});

	it("reloads outcomes, runs, and events from SQLite without board columns", async () => {
		await withTemporaryHome(async () => {
			recordCreatedOutcome({
				projectId: "demo",
				repoPath: "/tmp/demo",
				outcomeId: "out-1",
				title: "Ship login",
				description: "Auth contract",
			});
			recordSpawnedRun({
				projectId: "demo",
				repoPath: "/tmp/demo",
				outcomeId: "out-1",
				runId: "run-a",
				prompt: "U1 auth slice",
			});
			appendEvent(openLedger(), {
				projectId: "demo",
				outcomeId: "out-1",
				runId: "run-a",
				kind: "spawn",
				payload: { source: "pi" },
			});

			closeAllLedgers();

			const ledger = openLedger();
			expect(listOutcomes(ledger, "demo")).toEqual([
				expect.objectContaining({
					id: "out-1",
					title: "Ship login",
					status: "open",
				}),
			]);
			expect(listRuns(ledger, "out-1")).toEqual([
				expect.objectContaining({
					id: "run-a",
					outcomeId: "out-1",
					status: "queued",
					prompt: "U1 auth slice",
				}),
			]);
			expect(listEvents(ledger, "out-1").map((event) => event.kind)).toEqual(["spawn"]);
		});
	});

	it("keeps create_chat 1:1 alias rows", async () => {
		await withTemporaryHome(async () => {
			recordCreatedChatIntent({
				projectId: "demo",
				repoPath: "/tmp/demo",
				cardId: "chat-1",
				prompt: "Ship login",
			});
			const ledger = openLedger();
			expect(listOutcomes(ledger, "demo")[0]?.id).toBe("chat-1");
			expect(listRuns(ledger, "chat-1")[0]?.id).toBe("chat-1");
		});
	});
});
