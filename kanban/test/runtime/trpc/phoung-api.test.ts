import { describe, expect, it, vi, beforeEach } from "vitest";
import {
	closeAllLedgers,
	recordCreatedOutcome,
	recordSpawnedRun,
	resetLedgerEventListeners,
	resetLedgerImportState,
} from "../../../src/ledger/index.js";
import { createBoardOperations } from "../../../src/trpc/phuong-api.js";
import { createTempDir } from "../../utilities/temp-dir.js";

const trpcMocks = vi.hoisted(() => ({
	createTRPCProxyClient: vi.fn(),
	httpBatchLink: vi.fn(() => ({})),
}));

const workspaceStateMocks = vi.hoisted(() => ({
	loadWorkspaceContext: vi.fn(),
	loadWorkspaceState: vi.fn(),
	mutateWorkspaceState: vi.fn(),
}));

vi.mock("@trpc/client", () => ({
	createTRPCProxyClient: trpcMocks.createTRPCProxyClient,
	httpBatchLink: trpcMocks.httpBatchLink,
}));

vi.mock("../../../src/state/workspace-state.js", () => ({
	loadWorkspaceContext: workspaceStateMocks.loadWorkspaceContext,
	loadWorkspaceState: workspaceStateMocks.loadWorkspaceState,
	mutateWorkspaceState: workspaceStateMocks.mutateWorkspaceState,
}));

vi.mock("../../../src/manager/phuong-session.js", () => ({
	getAvailableModels: () => [],
	getSessionStats: () => null,
	getActiveTurn: () => null,
}));

vi.mock("../../../src/manager/session-history.js", () => ({
	listSessions: () => [],
	loadSession: () => null,
}));

vi.mock("/workspace/kanban/src/memory/memory-service.js", () => ({
	isMemoryConfigured: () => false,
	getMemoryDir: () => "/tmp",
}));

function createRuntimeClient() {
	return {
		projects: {
			add: {
				mutate: vi.fn(async () => ({
					ok: true,
					project: { id: "workspace-1" },
				})),
			},
		},
		workspace: {
			getState: {
				query: vi.fn(async () => ({
					board: { columns: [], dependencies: [] },
					sessions: {},
				})),
			},
			ensureWorktree: {
				mutate: vi.fn(async () => ({
					ok: true,
					path: "/tmp/worktree",
					baseRef: "HEAD",
					baseCommit: "abc1234",
				})),
			},
		},
		runtime: {
			startTaskSession: {
				mutate: vi.fn(async () => ({
					ok: true,
					summary: {
						taskId: "run-1",
						state: "running",
					},
				})),
			},
		},
	};
}

async function withTemporaryHome<T>(run: () => Promise<T>): Promise<T> {
	const { path: tempHome, cleanup } = createTempDir("kanban-phuong-api-home-");
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

describe("createBoardOperations Phase 6 ledger start", () => {
	beforeEach(() => {
		trpcMocks.createTRPCProxyClient.mockReset();
		trpcMocks.httpBatchLink.mockReset();
		workspaceStateMocks.loadWorkspaceContext.mockReset();
		workspaceStateMocks.loadWorkspaceState.mockReset();
		workspaceStateMocks.mutateWorkspaceState.mockReset();
		trpcMocks.httpBatchLink.mockReturnValue({});
		workspaceStateMocks.loadWorkspaceContext.mockResolvedValue({
			repoPath: "/tmp/repo",
			workspaceId: "workspace-1",
		});
	});

	it("starts a ledger run without reading or writing board columns", async () => {
		await withTemporaryHome(async () => {
			recordCreatedOutcome({
				projectId: "workspace-1",
				repoPath: "/tmp/repo",
				outcomeId: "out-1",
				title: "Ship login",
				description: "Ship login",
			});
			recordSpawnedRun({
				projectId: "workspace-1",
				repoPath: "/tmp/repo",
				outcomeId: "out-1",
				runId: "run-1",
				prompt: "Do the thing",
				model: "kimi-coding/kimi-k2.7",
			});

			const runtimeClient = createRuntimeClient();
			trpcMocks.createTRPCProxyClient.mockReturnValue(runtimeClient);

			const onBoardMutated = vi.fn();
			const boardOps = createBoardOperations("/tmp/repo", onBoardMutated);
			const result = await boardOps.startTask("run-1");

			expect(result).toEqual({ ok: true });
			expect(runtimeClient.workspace.ensureWorktree.mutate).toHaveBeenCalledWith({
				taskId: "run-1",
				baseRef: "HEAD",
			});
			expect(runtimeClient.runtime.startTaskSession.mutate).toHaveBeenCalledWith(
				expect.objectContaining({
					taskId: "run-1",
					prompt: "Do the thing",
					baseRef: "HEAD",
					model: "kimi-coding/kimi-k2.7",
				}),
			);
			expect(workspaceStateMocks.mutateWorkspaceState).not.toHaveBeenCalled();
			expect(onBoardMutated).not.toHaveBeenCalled();
		});
	});

	it("lists chats from ledger runs, not board columns", async () => {
		await withTemporaryHome(async () => {
			recordCreatedOutcome({
				projectId: "workspace-1",
				repoPath: "/tmp/repo",
				outcomeId: "out-1",
				title: "Ship login",
				description: "Ship login",
			});
			recordSpawnedRun({
				projectId: "workspace-1",
				repoPath: "/tmp/repo",
				outcomeId: "out-1",
				runId: "run-a",
				prompt: "U1 auth",
			});
			recordSpawnedRun({
				projectId: "workspace-1",
				repoPath: "/tmp/repo",
				outcomeId: "out-1",
				runId: "run-b",
				prompt: "U2 ui",
			});

			trpcMocks.createTRPCProxyClient.mockReturnValue(createRuntimeClient());
			const boardOps = createBoardOperations("/tmp/repo");
			const cards = await boardOps.listCards();

			expect(cards.map((card) => card.id)).toEqual(["run-a", "run-b"]);
			expect(cards[0]).toMatchObject({
				id: "run-a",
				prompt: "U1 auth",
				column: "queued",
				sessionState: "queued",
			});
			expect(workspaceStateMocks.mutateWorkspaceState).not.toHaveBeenCalled();
		});
	});

	it("spawn_run records a ledger run and starts it without a board card", async () => {
		await withTemporaryHome(async () => {
			recordCreatedOutcome({
				projectId: "workspace-1",
				repoPath: "/tmp/repo",
				outcomeId: "out-1",
				title: "Ship login",
				description: "Ship login",
			});

			const runtimeClient = createRuntimeClient();
			trpcMocks.createTRPCProxyClient.mockReturnValue(runtimeClient);
			const boardOps = createBoardOperations("/tmp/repo");
			const result = await boardOps.spawnRun("out-1", "U1 auth slice", { tier: "T1" });

			expect(result.ok).toBe(true);
			expect(result.outcomeId).toBe("out-1");
			expect(result.runId).toBeTruthy();
			expect(runtimeClient.runtime.startTaskSession.mutate).toHaveBeenCalledWith(
				expect.objectContaining({
					taskId: result.runId,
					prompt: "U1 auth slice",
					baseRef: "HEAD",
				}),
			);
			expect(workspaceStateMocks.mutateWorkspaceState).not.toHaveBeenCalled();

			const listed = await boardOps.listRuns("out-1");
			expect(listed.map((run) => run.id)).toEqual([result.runId]);
		});
	});
});
