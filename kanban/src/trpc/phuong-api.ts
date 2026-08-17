import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type { RuntimeTaskArtifact, RuntimeTaskTier } from "../core/api-contract.js";
import { buildKanbanRuntimeUrl } from "../core/runtime-endpoint.js";
import {
	getOutcome,
	getRunWithOutcome,
	listEvents,
	listOutcomes,
	listRuns,
	openLedger,
	outcomeTitleFromPrompt,
	recordArtifactEvent,
	recordCreatedChatIntent,
	recordCreatedOutcome,
	recordGateEvent,
	recordSpawnedRun,
	type LedgerEventRecord,
} from "../ledger/index.js";
import { getActiveTurn, getAvailableModels, getSessionStats } from "../manager/phuong-session.js";
import type { BoardOperations } from "../manager/phuong-tools.js";
import { listSessions, loadSession } from "../manager/session-history.js";
import { parseTaskAgentStatus } from "../manager/task-status-protocol.js";
import { loadWorkspaceContext } from "../state/workspace-state.js";
import type { RuntimeAppRouter } from "./app-router.js";

const execFileAsync = promisify(execFile);
const DEFAULT_RUN_BASE_REF = "HEAD";

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

function artifactFromEvent(event: LedgerEventRecord): RuntimeTaskArtifact | null {
	const path = typeof event.payload.path === "string" ? event.payload.path : null;
	const mimeType = typeof event.payload.mimeType === "string" ? event.payload.mimeType : null;
	if (!path || !mimeType) {
		return null;
	}
	return {
		id: typeof event.payload.id === "string" ? event.payload.id : event.id,
		path,
		mimeType,
		label: typeof event.payload.label === "string" ? event.payload.label : undefined,
		createdAt: event.createdAt,
	};
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

export function createBoardOperations(workspacePath: string, _onBoardMutated?: () => void): BoardOperations {
	const ops: BoardOperations = {
		createCard: async (_prompt: string, _baseRef?: string, options?: { model?: string; tier?: RuntimeTaskTier }) => {
			const cardId = randomUUID().slice(0, 8);
			return { cardId, model: options?.model, tier: options?.tier };
		},

		recordCreatedChat: async (input) => {
			try {
				const workspace = await loadWorkspaceContext(workspacePath);
				recordCreatedChatIntent({
					projectId: workspace.workspaceId,
					repoPath: workspace.repoPath,
					cardId: input.cardId,
					prompt: input.prompt,
					model: input.model,
					tier: input.tier,
				});
			} catch {
				// Ledger write is best-effort for the create_chat alias.
			}
		},

		createOutcome: async (description: string, title?: string) => {
			const workspace = await loadWorkspaceContext(workspacePath);
			const outcomeId = randomUUID().slice(0, 8);
			const resolvedTitle = title?.trim() || outcomeTitleFromPrompt(description);
			const outcome = recordCreatedOutcome({
				projectId: workspace.workspaceId,
				repoPath: workspace.repoPath,
				outcomeId,
				title: resolvedTitle,
				description,
			});
			if (!outcome) {
				throw new Error("Could not create outcome in the ledger.");
			}
			return { outcomeId: outcome.id, title: outcome.title };
		},

		spawnRun: async (
			outcomeId: string,
			prompt: string,
			options?: { model?: string; tier?: RuntimeTaskTier },
		) => {
			try {
				const workspace = await loadWorkspaceContext(workspacePath);
				const existing = getOutcome(openLedger(), outcomeId);
				if (!existing) {
					return { ok: false, error: `Outcome "${outcomeId}" was not found.` };
				}
				const runId = randomUUID().slice(0, 8);
				const run = recordSpawnedRun({
					projectId: workspace.workspaceId,
					repoPath: workspace.repoPath,
					outcomeId,
					runId,
					prompt,
					model: options?.model,
					tier: options?.tier,
				});
				if (!run) {
					return { ok: false, error: `Could not record run under outcome "${outcomeId}".` };
				}
				const started = await ops.startTask(run.id);
				if (!started.ok) {
					return {
						ok: false,
						runId: run.id,
						outcomeId,
						model: options?.model,
						tier: options?.tier,
						error: started.error,
					};
				}
				return {
					ok: true,
					runId: run.id,
					outcomeId,
					model: options?.model,
					tier: options?.tier,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { ok: false, error: message };
			}
		},

		listOutcomes: async () => {
			try {
				const workspace = await loadWorkspaceContext(workspacePath);
				return listOutcomes(openLedger(), workspace.workspaceId).map((outcome) => ({
					id: outcome.id,
					title: outcome.title,
					description: outcome.description,
					status: outcome.status,
				}));
			} catch {
				return [];
			}
		},

		listRuns: async (outcomeId: string) => {
			try {
				return listRuns(openLedger(), outcomeId).map((run) => ({
					id: run.id,
					outcomeId: run.outcomeId,
					status: run.status,
					prompt: run.prompt,
					model: run.model,
					tier: run.tier,
				}));
			} catch {
				return [];
			}
		},

		listCards: async () => {
			try {
				const workspace = await loadWorkspaceContext(workspacePath);
				const ledger = openLedger();
				const cards: {
					id: string;
					prompt: string;
					column: string;
					sessionState?: string;
					model?: string;
					tier?: string;
				}[] = [];
				for (const outcome of listOutcomes(ledger, workspace.workspaceId)) {
					for (const run of listRuns(ledger, outcome.id)) {
						cards.push({
							id: run.id,
							prompt: run.prompt,
							column: run.status,
							sessionState: run.status,
							model: run.model ?? undefined,
							tier: run.tier ?? undefined,
						});
					}
				}
				return cards;
			} catch {
				return [];
			}
		},

		getSessionSummary: async (taskId: string) => {
			try {
				const runtimeWorkspace = await ensureRuntimeWorkspace(workspacePath);
				const runtimeClient = createRuntimeTrpcClient(runtimeWorkspace.workspaceId);
				const runtimeState = await runtimeClient.workspace.getState.query();
				const session = runtimeState.sessions[taskId];
				if (session) {
					const finalMessage = session.latestHookActivity?.finalMessage ?? null;
					return {
						state: session.state,
						exitCode: session.exitCode ?? null,
						reviewReason: session.reviewReason ?? null,
						lastActivity: session.latestHookActivity?.activityText ?? null,
						reportedStatus: parseTaskAgentStatus(finalMessage),
					};
				}
			} catch {
				// Live PTY summary is optional; fall back to ledger run status.
			}
			const identity = getRunWithOutcome(openLedger(), taskId);
			if (!identity) {
				return null;
			}
			return {
				state: identity.run.status,
				exitCode: null,
				reviewReason: null,
				lastActivity: null,
				reportedStatus: identity.run.reportedStatus
					? { status: identity.run.reportedStatus, reason: null }
					: null,
			};
		},

		startTask: async (taskId: string) => {
			try {
				const identity = getRunWithOutcome(openLedger(), taskId);
				if (!identity) {
					return { ok: false, error: `Run "${taskId}" was not found.` };
				}

				const runtimeWorkspace = await ensureRuntimeWorkspace(workspacePath);
				const runtimeClient = createRuntimeTrpcClient(runtimeWorkspace.workspaceId);
				let existingSession: { state?: string } | null = null;
				try {
					const runtimeState = await runtimeClient.workspace.getState.query();
					existingSession = runtimeState.sessions[taskId] ?? null;
				} catch {
					existingSession = null;
				}

				const shouldStartSession = !existingSession || existingSession.state !== "running";
				if (shouldStartSession) {
					const ensured = await runtimeClient.workspace.ensureWorktree.mutate({
						taskId: identity.run.id,
						baseRef: DEFAULT_RUN_BASE_REF,
					});
					if (!ensured.ok) {
						return {
							ok: false,
							error: ensured.error ?? "Could not ensure task worktree.",
						};
					}

					const started = await runtimeClient.runtime.startTaskSession.mutate({
						taskId: identity.run.id,
						prompt: identity.run.prompt,
						startInPlanMode: false,
						baseRef: DEFAULT_RUN_BASE_REF,
						model: identity.run.model ?? undefined,
					});
					if (!started.ok || !started.summary) {
						return {
							ok: false,
							error: started.error ?? "Could not start task session.",
						};
					}
				}

				return { ok: true };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { ok: false, error: message };
			}
		},

		runGate: async (taskId: string, command: string) => {
			try {
				const identity = getRunWithOutcome(openLedger(), taskId);
				if (!identity) {
					return { ok: false, exitCode: null, output: "", error: `Run "${taskId}" was not found.` };
				}
				const runtimeWorkspace = await ensureRuntimeWorkspace(workspacePath);
				const runtimeClient = createRuntimeTrpcClient(runtimeWorkspace.workspaceId);
				const ensured = await runtimeClient.workspace.ensureWorktree.mutate({
					taskId: identity.run.id,
					baseRef: DEFAULT_RUN_BASE_REF,
				});
				if (!ensured.ok || !ensured.path) {
					return {
						ok: false,
						exitCode: null,
						output: "",
						error: ensured.error ?? "Could not resolve chat worktree.",
					};
				}
				let result: { ok: true; exitCode: number; output: string };
				try {
					const { stdout, stderr } = await execFileAsync("bash", ["-lc", command], {
						cwd: ensured.path,
						timeout: 10 * 60 * 1000,
						maxBuffer: 2 * 1024 * 1024,
						env: process.env,
					});
					result = {
						ok: true,
						exitCode: 0,
						output: `${stdout}${stderr ? `\n${stderr}` : ""}`.trim(),
					};
				} catch (error) {
					const err = error as {
						code?: number | string;
						stdout?: string;
						stderr?: string;
						message?: string;
					};
					const exitCode = typeof err.code === "number" ? err.code : 1;
					result = {
						ok: true,
						exitCode,
						output:
							`${err.stdout ?? ""}${err.stderr ? `\n${err.stderr}` : ""}`.trim() ||
							err.message ||
							String(error),
					};
				}
				recordGateEvent({
					taskId,
					workspaceId: runtimeWorkspace.workspaceId,
					repoPath: runtimeWorkspace.workspacePath,
					command,
					exitCode: result.exitCode,
					output: result.output,
				});
				return result;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { ok: false, exitCode: null, output: "", error: message };
			}
		},

		attachArtifact: async (taskId, artifactInput) => {
			try {
				const identity = getRunWithOutcome(openLedger(), taskId);
				if (!identity) {
					return { ok: false, error: `Run "${taskId}" was not found.` };
				}
				const runtimeWorkspace = await ensureRuntimeWorkspace(workspacePath);
				const runtimeClient = createRuntimeTrpcClient(runtimeWorkspace.workspaceId);
				const ensured = await runtimeClient.workspace.ensureWorktree.mutate({
					taskId: identity.run.id,
					baseRef: DEFAULT_RUN_BASE_REF,
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

				recordArtifactEvent({
					taskId,
					workspaceId: runtimeWorkspace.workspaceId,
					repoPath: runtimeWorkspace.workspacePath,
					artifact,
				});
				return { ok: true, artifact };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { ok: false, error: message };
			}
		},

		listArtifacts: async (taskId: string) => {
			const identity = getRunWithOutcome(openLedger(), taskId);
			if (!identity) {
				return [];
			}
			return listEvents(openLedger(), identity.outcome.id)
				.filter((event) => event.kind === "artifact" && event.runId === identity.run.id)
				.map(artifactFromEvent)
				.filter((artifact): artifact is RuntimeTaskArtifact => artifact !== null);
		},
	};
	return ops;
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
