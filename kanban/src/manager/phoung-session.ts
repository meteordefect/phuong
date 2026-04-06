import {
	createAgentSession,
	DefaultResourceLoader,
	SessionManager,
	AuthStorage,
	ModelRegistry,
	SettingsManager,
	type AgentSession,
	type AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import { join, dirname } from "node:path";
import { isMemoryConfigured, getMemoryDir } from "../memory/memory-service.js";
import { assemblePhoungSystemPrompt, assemblePhoungContext } from "./phoung-context.js";
import { createPhoungTools, type BoardOperations } from "./phoung-tools.js";
import { scrubCredentials, scrubSessionFile } from "./credential-scrubber.js";
import {
	normalizeModelKey,
	resolveModelByInput,
	selectPreferredPhoungModel,
} from "./phoung-model-selection.js";

export interface PhoungStreamEvent {
	type: string;
	[key: string]: unknown;
}

export type PhoungStreamCallback = (event: PhoungStreamEvent) => void;

const activeSessions = new Map<string, AgentSession>();

function setupAuth(): AuthStorage {
	const auth = AuthStorage.create();
	const kimi = process.env.KIMI_API_KEY || "";
	const zai = process.env.ZAI_API_KEY || "";
	const anthropic = process.env.ANTHROPIC_API_KEY || "";
	if (kimi) auth.setRuntimeApiKey("kimi-coding", kimi);
	if (zai) auth.setRuntimeApiKey("zai", zai);
	if (anthropic) auth.setRuntimeApiKey("anthropic", anthropic);
	return auth;
}

function getSessionDir(): string {
	if (isMemoryConfigured()) {
		return join(getMemoryDir(), "sessions");
	}
	return join(process.env.HOME || "/tmp", ".phoung-sessions");
}

async function createPhoungSession(
	conversationId: string,
	boardOps: BoardOperations,
	resumeSessionPath?: string,
): Promise<AgentSession> {
	const systemPrompt = assemblePhoungSystemPrompt();
	const contextText = assemblePhoungContext();

	const authStorage = setupAuth();
	const cwd = isMemoryConfigured() ? getMemoryDir() : process.cwd();

	const loader = new DefaultResourceLoader({
		cwd,
		systemPromptOverride: () => systemPrompt,
		agentsFilesOverride: (current) => ({
			agentsFiles: [
				...current.agentsFiles,
				...(contextText
					? [{ path: "/virtual/context.md", content: contextText }]
					: []),
			],
		}),
	});
	await loader.reload();

	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: true },
		retry: { enabled: true, maxRetries: 2 },
	});

	const sessionDir = getSessionDir();
	const appDir = isMemoryConfigured() ? dirname(getMemoryDir()) : process.cwd();

	const customTools = createPhoungTools(boardOps);
	const modelRegistry = ModelRegistry.create(authStorage);
	const availableModels = modelRegistry.getAvailable();
	const model = selectPreferredPhoungModel(availableModels, process.env.DEFAULT_MODEL || "") ?? undefined;

	const sessionManager = resumeSessionPath
		? SessionManager.open(resumeSessionPath, sessionDir)
		: SessionManager.create(cwd, sessionDir);

	console.error(`[phoung] ${resumeSessionPath ? "Resuming" : "Creating"} session. model=${model ? `${model.provider}/${model.id}` : "none"}, cwd=${appDir}`);

	const { session } = await createAgentSession({
		cwd: appDir,
		model,
		sessionManager,
		authStorage,
		modelRegistry,
		resourceLoader: loader,
		settingsManager,
		customTools,
	});

	activeSessions.set(conversationId, session);
	return session;
}

function formatToolResult(result: unknown): string {
	if (!result) return "";
	if (typeof result === "string") return result;
	if (typeof result === "object" && result !== null && "content" in result) {
		const r = result as { content: { text?: string }[] };
		return r.content.map((c) => c.text || "").join("\n");
	}
	return JSON.stringify(result, null, 2);
}

function mapSessionEvent(
	event: AgentSessionEvent,
	onEvent: PhoungStreamCallback,
	responseRef: { text: string },
): void {
	switch (event.type) {
		case "turn_start":
			onEvent({ type: "turn_start" });
			break;
		case "turn_end":
			onEvent({ type: "turn_end" });
			break;
		case "message_update": {
			const ame = event.assistantMessageEvent;
			switch (ame.type) {
				case "text_delta":
					responseRef.text += ame.delta;
					onEvent({ type: "text_delta", content: ame.delta });
					break;
				case "thinking_start":
					onEvent({ type: "thinking_start" });
					break;
				case "thinking_delta":
					onEvent({ type: "thinking_delta", content: ame.delta });
					break;
				case "thinking_end":
					onEvent({ type: "thinking_end" });
					break;
				case "done":
					break;
				case "error":
					onEvent({
						type: "error",
						message: ame.error?.errorMessage || `LLM error: ${ame.reason}`,
					});
					break;
			}
			break;
		}
		case "tool_execution_start":
			onEvent({
				type: "tool_start",
				toolCallId: event.toolCallId,
				name: event.toolName,
				args: event.args,
			});
			break;
		case "tool_execution_update":
			onEvent({
				type: "tool_update",
				toolCallId: event.toolCallId,
				name: event.toolName,
				partialResult: scrubCredentials(formatToolResult(event.partialResult)),
			});
			break;
		case "tool_execution_end":
			onEvent({
				type: "tool_end",
				toolCallId: event.toolCallId,
				name: event.toolName,
				result: scrubCredentials(formatToolResult(event.result)),
				isError: event.isError,
			});
			break;
		case "compaction_start":
			onEvent({ type: "status", message: `Compacting context (${event.reason})...` });
			break;
		case "compaction_end":
			onEvent({ type: "status", message: event.result ? "Context compacted" : "Compaction had no result" });
			break;
		case "auto_retry_start":
			onEvent({ type: "status", message: `Retrying (${event.attempt}/${event.maxAttempts})...` });
			break;
		case "auto_retry_end":
			if (!event.success) {
				onEvent({ type: "error", message: event.finalError || "Retry failed" });
			}
			break;
	}
}

const activeTurns = new Map<string, { conversationId: string; startedAt: number }>();

export async function phoungChatStream(
	userMessage: string,
	conversationId: string,
	boardOps: BoardOperations,
	onEvent: PhoungStreamCallback,
	model?: string,
	resumeSessionPath?: string,
): Promise<void> {
	let session = activeSessions.get(conversationId);
	if (!session) {
		session = await createPhoungSession(conversationId, boardOps, resumeSessionPath);
	}

	if (model) {
		const registry = ModelRegistry.create(setupAuth());
		const available = registry.getAvailable();
		const match = resolveModelByInput(available, model);
		if (match) {
			await session.setModel(match);
		}
	}

	activeTurns.set(conversationId, { conversationId, startedAt: Date.now() });

	const responseRef = { text: "" };
	const unsubscribe = session.subscribe((event) => {
		mapSessionEvent(event, onEvent, responseRef);
	});

	try {
		await session.prompt(userMessage);
	} catch (err) {
		console.error("[phoung] session.prompt error:", err);
		onEvent({ type: "error", message: err instanceof Error ? err.message : String(err) });
	} finally {
		unsubscribe();
		activeTurns.delete(conversationId);
	}

	const sessionFilePath = session.sessionFile;
	if (sessionFilePath) {
		scrubSessionFile(sessionFilePath).catch((err) => {
			console.error("[phoung] Failed to scrub session file:", err);
		});
	}

	if (!responseRef.text.trim()) {
		console.error("[phoung] No response text after prompt. Model may not be configured.");
		onEvent({
			type: "error",
			message: "Model returned no response. Check API key validity and model availability.",
		});
	}
}

export function getActiveTurn(conversationId: string) {
	return activeTurns.get(conversationId) || null;
}

export function disposeSession(conversationId: string): void {
	const session = activeSessions.get(conversationId);
	if (session) {
		session.dispose();
		activeSessions.delete(conversationId);
	}
}

export function getAvailableModels(): { id: string; label: string; isDefault: boolean }[] {
	const authStorage = setupAuth();
	const modelRegistry = ModelRegistry.create(authStorage);
	const available = modelRegistry.getAvailable();
	const defaultModel = process.env.DEFAULT_MODEL || "";
	const preferredModel = selectPreferredPhoungModel(available, defaultModel);
	const preferredModelKey = preferredModel ? normalizeModelKey(preferredModel) : "";

	return available.map((m) => ({
		id: `${m.provider}/${m.id}`,
		label: `${m.provider}/${m.id}`,
		isDefault:
			(m.id === defaultModel || `${m.provider}/${m.id}` === defaultModel) ||
			(preferredModelKey.length > 0 && normalizeModelKey(m) === preferredModelKey),
	}));
}

export function getSessionStats(conversationId: string) {
	const session = activeSessions.get(conversationId);
	if (!session) return null;
	const stats = session.getSessionStats();
	const context = session.getContextUsage();
	return {
		userMessages: stats.userMessages,
		assistantMessages: stats.assistantMessages,
		toolCalls: stats.toolCalls,
		totalMessages: stats.totalMessages,
		tokens: stats.tokens,
		cost: stats.cost,
		context: context
			? {
					tokens: context.tokens,
					contextWindow: context.contextWindow,
					percent: context.percent,
				}
			: null,
	};
}
