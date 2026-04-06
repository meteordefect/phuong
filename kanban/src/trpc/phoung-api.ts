import { randomUUID } from "node:crypto";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type { BoardOperations } from "../manager/phoung-tools.js";
import { getAvailableModels, getSessionStats, getActiveTurn } from "../manager/phoung-session.js";
import { listSessions, loadSession } from "../manager/session-history.js";
import { moveTaskToColumn } from "../core/task-board-mutations.js";
import { buildKanbanRuntimeUrl } from "../core/runtime-endpoint.js";
import { loadWorkspaceContext, loadWorkspaceState, mutateWorkspaceState } from "../state/workspace-state.js";
import type { RuntimeBoardCard, RuntimeBoardData } from "../core/api-contract.js";
import type { RuntimeAppRouter } from "./app-router.js";

function createRuntimeTrpcClient(workspaceId: string | null) {
	return createTRPCProxyClient<RuntimeAppRouter>({
		links: [
			httpBatchLink({
				url: buildKanbanRuntimeUrl("/api/trpc"),
				headers: () => (workspaceId ? { "x-kanban-workspace-id": workspaceId } : {}),
			}),
		],
	});
}

function findTaskRecord(
	state: Awaited<ReturnType<ReturnType<typeof createRuntimeTrpcClient>["workspace"]["getState"]["query"]>>,
	taskId: string,
): { task: RuntimeBoardCard; columnId: string } | null {
	for (const column of state.board.columns) {
		const task = column.cards.find((candidate) => candidate.id === taskId);
		if (task) {
			return { task, columnId: column.id };
		}
	}
	return null;
}

async function ensureRuntimeWorkspace(workspacePath: string): Promise<{ workspacePath: string; workspaceId: string }> {
	const workspace = await loadWorkspaceContext(workspacePath);
	const runtimeClient = createRuntimeTrpcClient(null);
	const added = await runtimeClient.projects.add.mutate({
		path: workspace.repoPath,
	});
	if (!added.ok || !added.project) {
		throw new Error(added.error ?? `Could not register project ${workspace.repoPath} in Kanban runtime.`);
	}
	return {
		workspacePath: workspace.repoPath,
		workspaceId: added.project.id,
	};
}

export function createBoardOperations(
	workspacePath: string,
	onBoardMutated?: () => void,
): BoardOperations {
	return {
		createCard: async (prompt: string, baseRef?: string) => {
			const cardId = randomUUID().slice(0, 8);
			const now = Date.now();
			const newCard: RuntimeBoardCard = {
				id: cardId,
				prompt,
				startInPlanMode: false,
				baseRef: baseRef || "HEAD",
				createdAt: now,
				updatedAt: now,
			};

			await mutateWorkspaceState(workspacePath, (state) => {
				const board: RuntimeBoardData = JSON.parse(JSON.stringify(state.board));
				const backlog = board.columns.find((c) => c.id === "backlog");
				if (backlog) {
					backlog.cards.push(newCard);
				}
				return { board, save: true, value: cardId };
			});

			onBoardMutated?.();
			return { cardId };
		},

		listCards: async () => {
			const state = await loadWorkspaceState(workspacePath);
			const cards: { id: string; prompt: string; column: string }[] = [];
			for (const col of state.board.columns) {
				for (const card of col.cards) {
					cards.push({ id: card.id, prompt: card.prompt, column: col.id });
				}
			}
			return cards;
		},

		startTask: async (taskId: string) => {
			try {
				const runtimeWorkspace = await ensureRuntimeWorkspace(workspacePath);
				const runtimeClient = createRuntimeTrpcClient(runtimeWorkspace.workspaceId);
				const runtimeState = await runtimeClient.workspace.getState.query();
				const taskRecord = findTaskRecord(runtimeState, taskId);
				if (!taskRecord) {
					return { ok: false, error: `Task "${taskId}" was not found.` };
				}

				if (taskRecord.columnId !== "backlog" && taskRecord.columnId !== "in_progress") {
					return {
						ok: false,
						error: `Task "${taskId}" is in "${taskRecord.columnId}" and cannot be started.`,
					};
				}

				const existingSession = runtimeState.sessions[taskId] ?? null;
				const shouldStartSession = !existingSession || existingSession.state !== "running";
				if (shouldStartSession) {
					const ensured = await runtimeClient.workspace.ensureWorktree.mutate({
						taskId: taskRecord.task.id,
						baseRef: taskRecord.task.baseRef,
					});
					if (!ensured.ok) {
						return {
							ok: false,
							error: ensured.error ?? "Could not ensure task worktree.",
						};
					}

					const started = await runtimeClient.runtime.startTaskSession.mutate({
						taskId: taskRecord.task.id,
						prompt: taskRecord.task.prompt,
						startInPlanMode: taskRecord.task.startInPlanMode,
						images: taskRecord.task.images,
						baseRef: taskRecord.task.baseRef,
					});
					if (!started.ok || !started.summary) {
						return {
							ok: false,
							error: started.error ?? "Could not start task session.",
						};
					}
				}

				await mutateWorkspaceState(runtimeWorkspace.workspacePath, (state) => {
					const moved = moveTaskToColumn(state.board, taskId, "in_progress");
					if (!moved.moved) {
						return {
							board: state.board,
							value: null,
							save: false,
						};
					}
					return {
						board: moved.board,
						value: null,
					};
				});

				onBoardMutated?.();
				return { ok: true };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { ok: false, error: message };
			}
		},
	};
}

export function createPhoungApi() {
	return {
		getModels: async () => {
			try {
				return await getAvailableModels();
			} catch {
				return [];
			}
		},

		getSessionStats: async (input: { conversationId: string }) => {
			return getSessionStats(input.conversationId);
		},

		getActiveTurn: async (input: { conversationId: string }) => {
			return getActiveTurn(input.conversationId);
		},

		listSessions: async () => {
			return listSessions();
		},

		loadSession: async (input: { sessionId: string }) => {
			return loadSession(input.sessionId);
		},
	};
}

export type PhoungApi = ReturnType<typeof createPhoungApi>;
