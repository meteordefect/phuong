import { describe, expect, it, vi, beforeEach } from "vitest";
import { createBoardOperations } from "../../../src/trpc/phoung-api.js";

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

vi.mock("../../../src/manager/phoung-session.js", () => ({
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

function createBoard() {
	return {
		columns: [
			{
				id: "backlog",
				title: "Backlog",
				cards: [
					{
						id: "task-1",
						prompt: "Do the thing",
						startInPlanMode: false,
						baseRef: "main",
						createdAt: 1,
						updatedAt: 1,
					},
				],
			},
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [],
	};
}

describe("createBoardOperations startTask", () => {
	beforeEach(() => {
		trpcMocks.createTRPCProxyClient.mockReset();
		trpcMocks.httpBatchLink.mockReset();
		workspaceStateMocks.loadWorkspaceContext.mockReset();
		workspaceStateMocks.loadWorkspaceState.mockReset();
		workspaceStateMocks.mutateWorkspaceState.mockReset();
		trpcMocks.httpBatchLink.mockReturnValue({});
	});

	it("starts backlog tasks via runtime and moves them to in_progress", async () => {
		const runtimeClient = {
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
						board: createBoard(),
						sessions: {},
					})),
				},
				ensureWorktree: {
					mutate: vi.fn(async () => ({
						ok: true,
						path: "/tmp/worktree",
						baseRef: "main",
						baseCommit: "abc1234",
					})),
				},
			},
			runtime: {
				startTaskSession: {
					mutate: vi.fn(async () => ({
						ok: true,
						summary: {
							taskId: "task-1",
							state: "running",
						},
					})),
				},
			},
		};

		trpcMocks.createTRPCProxyClient.mockReturnValue(runtimeClient);
		workspaceStateMocks.loadWorkspaceContext.mockResolvedValue({
			repoPath: "/tmp/repo",
		});
		workspaceStateMocks.mutateWorkspaceState.mockImplementation(async (_workspacePath, mutate) => {
			const result = mutate({
				board: createBoard(),
			});
			return {
				value: result.value,
				state: {
					board: result.board,
				},
				saved: result.save !== false,
			};
		});

		const onBoardMutated = vi.fn();
		const boardOps = createBoardOperations("/tmp/repo", onBoardMutated);
		const result = await boardOps.startTask("task-1");

		expect(result).toEqual({ ok: true });
		expect(runtimeClient.workspace.ensureWorktree.mutate).toHaveBeenCalledWith({
			taskId: "task-1",
			baseRef: "main",
		});
		expect(runtimeClient.runtime.startTaskSession.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-1",
				prompt: "Do the thing",
				baseRef: "main",
			}),
		);
		expect(workspaceStateMocks.mutateWorkspaceState).toHaveBeenCalledTimes(1);
		expect(onBoardMutated).toHaveBeenCalledTimes(1);
	});
});
