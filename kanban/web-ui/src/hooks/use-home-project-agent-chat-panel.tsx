// Full-width home surface: Hermes conduit or watch-only project chats.
import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AgentTerminalPanel } from "@/components/detail-panels/agent-terminal-panel";
import { ClineAgentChatPanel } from "@/components/detail-panels/cline-agent-chat-panel";
import { PhuongChatPanel } from "@/components/phuong/phuong-chat-panel";
import { Spinner } from "@/components/ui/spinner";
import { createIdleTaskSession } from "@/hooks/app-utils";
import { useClineChatRuntimeActions } from "@/hooks/use-cline-chat-runtime-actions";
import { isNativeClineAgentSelected, selectLatestTaskChatMessageForTask } from "@/runtime/native-agent";
import { isRuntimeAgentLaunchSupported } from "@runtime-agent-catalog";
import type {
	RuntimeConfigResponse,
	RuntimeStateStreamTaskChatMessage,
	RuntimeTaskChatMessage,
	RuntimeTaskSessionSummary,
} from "@/runtime/types";
import { findCardSelection } from "@/state/board-state";
import { TERMINAL_THEME_COLORS } from "@/terminal/theme-colors";
import type { BoardData } from "@/types";

export type HomeSurfaceMode = "hermes" | "dashboard";

interface UseHomeProjectAgentChatPanelInput {
	currentProjectId: string | null;
	hasNoProjects: boolean;
	runtimeProjectConfig: RuntimeConfigResponse | null;
	board: BoardData;
	selectedTaskId: string | null;
	homeSurfaceMode: HomeSurfaceMode;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	clineSessionContextVersion: number;
	latestTaskChatMessage: RuntimeStateStreamTaskChatMessage | null;
	taskChatMessagesByTaskId: Record<string, RuntimeTaskChatMessage[]>;
	onSessionSummary: (summary: RuntimeTaskSessionSummary) => void;
	onCreateNewChat: () => void;
	onReturnToHermes: () => void;
}

export function useHomeProjectAgentChatPanel({
	currentProjectId,
	hasNoProjects,
	runtimeProjectConfig,
	board,
	selectedTaskId,
	homeSurfaceMode,
	taskSessions,
	clineSessionContextVersion,
	latestTaskChatMessage,
	taskChatMessagesByTaskId,
	onSessionSummary,
	onCreateNewChat,
	onReturnToHermes,
}: UseHomeProjectAgentChatPanelInput): ReactElement | null {
	const [interjectUnlocked, setInterjectUnlocked] = useState(false);

	useEffect(() => {
		setInterjectUnlocked(false);
	}, [selectedTaskId]);

	const { sendTaskChatMessage, loadTaskChatMessages, cancelTaskChatTurn } = useClineChatRuntimeActions({
		currentProjectId,
		onSessionSummary,
	});

	const selectedAgentLabel = useMemo(() => {
		if (!runtimeProjectConfig) {
			return "selected agent";
		}
		return (
			runtimeProjectConfig.agents.find((agent) => agent.id === runtimeProjectConfig.selectedAgentId)?.label ??
			"selected agent"
		);
	}, [runtimeProjectConfig]);

	const handleSend = useCallback(
		async (taskId: string, text: string, options?: { mode?: "act" | "plan" }) =>
			await sendTaskChatMessage(taskId, text, options),
		[sendTaskChatMessage],
	);

	const handleLoad = useCallback(
		async (taskId: string) => await loadTaskChatMessages(taskId),
		[loadTaskChatMessages],
	);

	const handleCancel = useCallback(
		async (taskId: string) => await cancelTaskChatTurn(taskId),
		[cancelTaskChatTurn],
	);

	const selection = useMemo(() => {
		if (!selectedTaskId) {
			return null;
		}
		return findCardSelection(board, selectedTaskId);
	}, [board, selectedTaskId]);

	const isClineAgent = isNativeClineAgentSelected(runtimeProjectConfig?.selectedAgentId);

	const panel = useMemo(() => {
		if (hasNoProjects || !currentProjectId) {
			return null;
		}

		// Hermes conduit: talk only to Hermes; she owns projects/chats.
		if (homeSurfaceMode === "hermes" && !selectedTaskId) {
			return (
				<div className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden bg-surface-0">
					<div className="border-b border-border bg-surface-1 px-4 py-2">
						<p className="text-sm font-medium text-text-primary">Hermes</p>
						<p className="text-[12px] text-text-tertiary">
							Your conduit. Ask for work and she routes Pi chats under projects. Open Dashboard to watch.
						</p>
					</div>
					<div className="flex min-h-0 flex-1 flex-col">
						<PhuongChatPanel workspaceId={currentProjectId} variant="conduit" />
					</div>
				</div>
			);
		}

		if (!runtimeProjectConfig) {
			return (
				<div className="flex flex-1 min-h-0 items-center justify-center bg-surface-0">
					<Spinner size={28} />
				</div>
			);
		}

		if (!isRuntimeAgentLaunchSupported(runtimeProjectConfig.selectedAgentId)) {
			return (
				<div className="flex flex-1 min-h-0 items-center justify-center bg-surface-0 px-6 text-center text-sm text-text-secondary">
					No runnable {selectedAgentLabel} command is configured. Open Settings, install the CLI, and select it.
				</div>
			);
		}

		if (!selectedTaskId) {
			return (
				<div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-3 bg-surface-0 px-6 text-center">
					<p className="text-sm text-text-secondary">No chat selected.</p>
					<p className="max-w-sm text-[12px] text-text-tertiary">
						Pick a project chat to watch, or go to Hermes and let her create work for you.
					</p>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={onReturnToHermes}
							className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity cursor-pointer"
						>
							Open Hermes
						</button>
						<button
							type="button"
							onClick={onCreateNewChat}
							className="rounded-md bg-surface-3 px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface-4 transition-colors cursor-pointer"
						>
							New Chat
						</button>
					</div>
				</div>
			);
		}

		const summary = taskSessions[selectedTaskId] ?? createIdleTaskSession(selectedTaskId);
		const artifacts = selection?.card.artifacts ?? [];
		const watchOnly = !interjectUnlocked;

		if (isClineAgent) {
			const taskMessages = taskChatMessagesByTaskId[selectedTaskId] ?? [];
			const latestForTask = selectLatestTaskChatMessageForTask(selectedTaskId, latestTaskChatMessage);

			return (
				<div className="flex min-h-0 flex-1 flex-col">
					{watchOnly ? (
						<div className="flex items-center justify-between gap-2 border-b border-border bg-surface-1 px-3 py-2">
							<div className="min-w-0">
								<p className="text-xs font-medium text-text-primary">Watching — Hermes is handling this</p>
								<p className="truncate text-[11px] text-text-tertiary">
									Read-only by default. Interject only if you need to.
								</p>
							</div>
							<div className="flex shrink-0 gap-2">
								<button
									type="button"
									onClick={onReturnToHermes}
									className="rounded-sm px-2 py-1 text-xs text-text-secondary hover:text-text-primary cursor-pointer"
								>
									Hermes
								</button>
								<button
									type="button"
									onClick={() => setInterjectUnlocked(true)}
									className="rounded-sm bg-surface-3 px-2 py-1 text-xs text-text-primary cursor-pointer"
								>
									Interject
								</button>
							</div>
						</div>
					) : null}
					{artifacts.length > 0 ? (
						<div className="flex gap-2 overflow-x-auto border-b border-border bg-surface-1 px-3 py-2">
							{artifacts.map((artifact) => (
								<div
									key={artifact.id}
									className="shrink-0 rounded-md border border-border bg-surface-2 px-2 py-1 text-[11px] text-text-secondary"
									title={artifact.path}
								>
									<span className="font-medium text-text-primary">{artifact.label ?? "Artifact"}</span>
									<span className="ml-1 font-mono text-text-tertiary">{artifact.path}</span>
								</div>
							))}
						</div>
					) : null}
					<div className={`flex min-h-0 flex-1 ${watchOnly ? "pointer-events-none opacity-95" : ""}`}>
						<ClineAgentChatPanel
							key={`${selectedTaskId}-${clineSessionContextVersion}`}
							taskId={selectedTaskId}
							summary={summary}
							taskColumnId={selection?.column.id}
							defaultMode="act"
							showComposerModeToggle={!watchOnly}
							workspaceId={currentProjectId}
							runtimeConfig={runtimeProjectConfig}
							onSendMessage={
								watchOnly
									? async () => ({ ok: false as const, message: "Watching only — use Interject to type." })
									: handleSend
							}
							onCancelTurn={handleCancel}
							onLoadMessages={handleLoad}
							incomingMessage={latestForTask}
							incomingMessages={taskMessages}
							showRightBorder={false}
							composerPlaceholder={watchOnly ? "Watching only — use Interject to type" : "Message this agent…"}
						/>
					</div>
				</div>
			);
		}

		return (
			<AgentTerminalPanel
				key={`${selectedTaskId}-${watchOnly ? "watch" : "interject"}`}
				taskId={selectedTaskId}
				workspaceId={currentProjectId}
				terminalEnabled
				readOnly={watchOnly}
				artifacts={artifacts}
				onRequestInterject={() => setInterjectUnlocked(true)}
				onReturnToHermes={onReturnToHermes}
				summary={summary}
				onSummary={onSessionSummary}
				showSessionToolbar={false}
				autoFocus={!watchOnly}
				showRightBorder={false}
				panelBackgroundColor={TERMINAL_THEME_COLORS.surfacePrimary}
				terminalBackgroundColor={TERMINAL_THEME_COLORS.surfacePrimary}
				taskColumnId={selection?.column.id}
			/>
		);
	}, [
		clineSessionContextVersion,
		currentProjectId,
		handleCancel,
		handleLoad,
		handleSend,
		hasNoProjects,
		homeSurfaceMode,
		interjectUnlocked,
		isClineAgent,
		latestTaskChatMessage,
		onCreateNewChat,
		onReturnToHermes,
		onSessionSummary,
		runtimeProjectConfig,
		selectedAgentLabel,
		selectedTaskId,
		selection?.card.artifacts,
		selection?.column.id,
		taskChatMessagesByTaskId,
		taskSessions,
	]);

	return panel;
}
