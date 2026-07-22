import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type { BoardOperations } from "../manager/phuong-tools.js";
import { getAvailableModels, getSessionStats, getActiveTurn } from "../manager/phuong-session.js";
import { listSessions, loadSession } from "../manager/session-history.js";
import { parseTaskAgentStatus } from "../manager/task-status-protocol.js";
import { moveTaskToColumn } from "../core/task-board-mutations.js";
import { buildKanbanRuntimeUrl } from "../core/runtime-endpoint.js";
import { loadWorkspaceContext, mutateWorkspaceState } from "../state/workspace-state.js";
import type {
	RuntimeBoardCard,
	RuntimeBoardData,
	RuntimeTaskArtifact,
	RuntimeTaskTier,
} from "../core/api-contract.js";
import type { RuntimeAppRouter } from "./app-router.js";

const execFileAsync = promisify(execFile);

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

function isPathInsideWorktree(worktreePath: string, candidatePath: string): boolean {
	const base = resolve(worktreePath);
	const candidate = resolve(candidatePath);
	const relativePath = relative(base, candidate);
	return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

export function createBoardOperations(
	workspacePath: string,
	onBoardMutated?: () => void,
): BoardOperations {
	return {
		createCard: async (prompt: string, baseRef?: string, options?: { model?: string; tier?: RuntimeTaskTier }) => {
			const cardId = randomUUID().slice(0, 8);
			const now = Date.now();
			const newCard: RuntimeBoardCard = {
				id: cardId,
				prompt,
				startInPlanMode: false,
				baseRef: baseRef || "HEAD",
				model: options?.model,
				tier: options?.tier,
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
			return { cardId, model: options?.model, tier: options?.tier };
		},

		listCards: async () => {
			const runtimeWorkspace = await ensureRuntimeWorkspace(workspacePath);
			const runtimeClient = createRuntimeTrpcClient(runtimeWorkspace.workspaceId);
			const runtimeState = await runtimeClient.workspace.getState.query();
			const cards: {
				id: string;
				prompt: string;
				column: string;
				sessionState?: string;
				model?: string;
				tier?: string;
			}[] = [];
			for (const col of runtimeState.board.columns) {
				for (const card of col.cards) {
					const session = runtimeState.sessions[card.id];
					cards.push({
						id: card.id,
						prompt: card.prompt,
						column: col.id,
						sessionState: session?.state,
						model: card.model,
						tier: card.tier,
					});
				}
			}
			return cards;
		},

		getSessionSummary: async (taskId: string) => {
			try {
				const runtimeWorkspace = await ensureRuntimeWorkspace(workspacePath);
				const runtimeClient = createRuntimeTrpcClient(runtimeWorkspace.workspaceId);
				const runtimeState = await runtimeClient.workspace.getState.query();
				const session = runtimeState.sessions[taskId];
				if (!session) {
					return null;
				}
				const finalMessage = session.latestHookActivity?.finalMessage ?? null;
				return {
					state: session.state,
					exitCode: session.exitCode ?? null,
					reviewReason: session.reviewReason ?? null,
					lastActivity: session.latestHookActivity?.activityText ?? null,
					reportedStatus: parseTaskAgentStatus(finalMessage),
				};
			} catch {
				return null;
			}
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
						model: taskRecord.task.model,
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

		runGate: async (taskId: string, command: string) => {
			try {
				const runtimeWorkspace = await ensureRuntimeWorkspace(workspacePath);
				const runtimeClient = createRuntimeTrpcClient(runtimeWorkspace.workspaceId);
				const runtimeState = await runtimeClient.workspace.getState.query();
				const taskRecord = findTaskRecord(runtimeState, taskId);
				if (!taskRecord) {
					return { ok: false, exitCode: null, output: "", error: `Task "${taskId}" was not found.` };
				}
				const ensured = await runtimeClient.workspace.ensureWorktree.mutate({
					taskId: taskRecord.task.id,
					baseRef: taskRecord.task.baseRef,
				});
				if (!ensured.ok || !ensured.path) {
					return {
						ok: false,
						exitCode: null,
						output: "",
						error: ensured.error ?? "Could not resolve chat worktree.",
					};
				}
				try {
					const { stdout, stderr } = await execFileAsync("bash", ["-lc", command], {
						cwd: ensured.path,
						timeout: 10 * 60 * 1000,
						maxBuffer: 2 * 1024 * 1024,
						env: process.env,
					});
					const output = `${stdout}${stderr ? `\n${stderr}` : ""}`.trim();
					return { ok: true, exitCode: 0, output };
				} catch (error) {
					const err = error as {
						code?: number | string;
						stdout?: string;
						stderr?: string;
						message?: string;
					};
					const exitCode = typeof err.code === "number" ? err.code : 1;
					const output = `${err.stdout ?? ""}${err.stderr ? `\n${err.stderr}` : ""}`.trim() || err.message || String(error);
					return { ok: true, exitCode, output };
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { ok: false, exitCode: null, output: "", error: message };
			}
		},

		attachArtifact: async (taskId, artifactInput) => {
			try {
				const runtimeWorkspace = await ensureRuntimeWorkspace(workspacePath);
				const runtimeClient = createRuntimeTrpcClient(runtimeWorkspace.workspaceId);
				const runtimeState = await runtimeClient.workspace.getState.query();
				const taskRecord = findTaskRecord(runtimeState, taskId);
				if (!taskRecord) {
					return { ok: false, error: `Task "${taskId}" was not found.` };
				}
				const ensured = await runtimeClient.workspace.ensureWorktree.mutate({
					taskId: taskRecord.task.id,
					baseRef: taskRecord.task.baseRef,
				});
				if (!ensured.ok || !ensured.path) {
					return { ok: false, error: ensured.error ?? "Could not resolve chat worktree." };
				}
				const worktreePath = ensured.path;
				const resolvedPath = resolve(worktreePath, artifactInput.path);
				if (!isPathInsideWorktree(worktreePath, resolvedPath)) {
					return { ok: false, error: "Artifact path must stay inside the chat worktree." };
				}
				try {
					await access(resolvedPath);
				} catch {
					return { ok: false, error: `Artifact not found at ${artifactInput.path}` };
				}
				const relativePath = relative(worktreePath, resolvedPath) || artifactInput.path;
				const artifact: RuntimeTaskArtifact = {
					id: artifactInput.id ?? randomUUID().slice(0, 8),
					path: relativePath.split(sep).join("/"),
					mimeType: artifactInput.mimeType,
					label: artifactInput.label,
					createdAt: Date.now(),
				};

				await mutateWorkspaceState(runtimeWorkspace.workspacePath, (state) => {
					const board: RuntimeBoardData = JSON.parse(JSON.stringify(state.board));
					for (const column of board.columns) {
						const card = column.cards.find((candidate) => candidate.id === taskId);
						if (!card) {
							continue;
						}
						const existing = card.artifacts ?? [];
						card.artifacts = [...existing.filter((item) => item.path !== artifact.path), artifact];
						card.updatedAt = Date.now();
						return { board, save: true, value: artifact };
					}
					return { board: state.board, save: false, value: null };
				});

				onBoardMutated?.();
				return { ok: true, artifact };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { ok: false, error: message };
			}
		},

		listArtifacts: async (taskId: string) => {
			const runtimeWorkspace = await ensureRuntimeWorkspace(workspacePath);
			const runtimeClient = createRuntimeTrpcClient(runtimeWorkspace.workspaceId);
			const runtimeState = await runtimeClient.workspace.getState.query();
			const taskRecord = findTaskRecord(runtimeState, taskId);
			return taskRecord?.task.artifacts ?? [];
		},
	};
}

export function createPhuongApi() {
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

export type PhuongApi = ReturnType<typeof createPhuongApi>;
