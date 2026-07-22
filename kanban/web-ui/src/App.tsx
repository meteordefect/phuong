// Main React composition root for the browser app.
// Keep this file focused on wiring top-level hooks and surfaces together, and
// push runtime-specific orchestration down into hooks and service modules.
import { FolderOpen } from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { notifyError, showAppToast } from "@/components/app-toaster";
import { ClearTrashDialog } from "@/components/clear-trash-dialog";
import { DebugDialog } from "@/components/debug-dialog";
import { AgentTerminalPanel } from "@/components/detail-panels/agent-terminal-panel";
import { GitHistoryView } from "@/components/git-history-view";
import { ProjectNavigationPanel } from "@/components/project-navigation-panel";
import { ResizableBottomPane } from "@/components/resizable-bottom-pane";
import { RuntimeSettingsDialog, type RuntimeSettingsSection } from "@/components/runtime-settings-dialog";
import { StartupOnboardingDialog } from "@/components/startup-onboarding-dialog";
import { TaskCreateDialog } from "@/components/task-create-dialog";
import { TaskInlineCreateCard } from "@/components/task-inline-create-card";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogBody,
	AlertDialogCancel,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { createInitialBoardData } from "@/data/board-data";
import { createIdleTaskSession } from "@/hooks/app-utils";
import { KanbanAccessBlockedFallback } from "@/hooks/kanban-access-blocked-fallback";
import { RuntimeDisconnectedFallback } from "@/hooks/runtime-disconnected-fallback";
import { useAppHotkeys } from "@/hooks/use-app-hotkeys";
import { useBoardInteractions } from "@/hooks/use-board-interactions";
import { useDebugTools } from "@/hooks/use-debug-tools";
import { useDocumentVisibility } from "@/hooks/use-document-visibility";
import { useGitActions } from "@/hooks/use-git-actions";
import { useHomeProjectAgentChatPanel } from "@/hooks/use-home-project-agent-chat-panel";
import { useProjectAgentChats } from "@/hooks/use-project-agent-chats";
import { useKanbanAccessGate } from "@/hooks/use-kanban-access-gate";
import { useOpenWorkspace } from "@/hooks/use-open-workspace";
import { usePrewarmedAgentTerminals } from "@/hooks/use-prewarmed-agent-terminals";
import { parseRemovedProjectPathFromStreamError, useProjectNavigation } from "@/hooks/use-project-navigation";
import { useProjectUiState } from "@/hooks/use-project-ui-state";
import { useReviewReadyNotifications } from "@/hooks/use-review-ready-notifications";
import { useShortcutActions } from "@/hooks/use-shortcut-actions";
import { useStartupOnboarding } from "@/hooks/use-startup-onboarding";
import { useTaskBranchOptions } from "@/hooks/use-task-branch-options";
import { useTaskEditor } from "@/hooks/use-task-editor";
import { useTaskSessions } from "@/hooks/use-task-sessions";
import { useTaskStartActions } from "@/hooks/use-task-start-actions";
import { useTerminalPanels } from "@/hooks/use-terminal-panels";
import { useWorkspaceSync } from "@/hooks/use-workspace-sync";
import {
	getTaskAgentNavbarHint,
	isTaskAgentSetupSatisfied,
} from "@/runtime/native-agent";
import { useIsMobile } from "@/utils/react-use";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import { useRuntimeProjectConfig } from "@/runtime/use-runtime-project-config";
import { useTerminalConnectionReady } from "@/runtime/use-terminal-connection-ready";
import { useWorkspacePersistence } from "@/runtime/use-workspace-persistence";
import { saveWorkspaceState } from "@/runtime/workspace-state-query";
import { addTaskToColumnWithResult, findCardSelection } from "@/state/board-state";
import {
	getTaskWorkspaceInfo,
	getTaskWorkspaceSnapshot,
	replaceWorkspaceMetadata,
	resetWorkspaceMetadataStore,
} from "@/stores/workspace-metadata-store";
import { TERMINAL_THEME_COLORS } from "@/terminal/theme-colors";
import type { BoardData } from "@/types";

export default function App(): ReactElement {
	const [board, setBoard] = useState<BoardData>(() => createInitialBoardData());
	const [sessions, setSessions] = useState<Record<string, RuntimeTaskSessionSummary>>({});
	const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
	const [canPersistWorkspaceState, setCanPersistWorkspaceState] = useState(false);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [settingsInitialSection, setSettingsInitialSection] = useState<RuntimeSettingsSection | null>(null);
	const [homeSidebarSection, setHomeSidebarSection] = useState<"projects" | "agent">("agent");
	const [isClearTrashDialogOpen, setIsClearTrashDialogOpen] = useState(false);
	const [isGitHistoryOpen, setIsGitHistoryOpen] = useState(false);
	const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
	const isMobile = useIsMobile();
	const [pendingTaskStartAfterEditId, setPendingTaskStartAfterEditId] = useState<string | null>(null);
	const [pendingNewChatStartId, setPendingNewChatStartId] = useState<string | null>(null);
	const taskEditorResetRef = useRef<() => void>(() => {});
	const lastStreamErrorRef = useRef<string | null>(null);
	const handleProjectSwitchStart = useCallback(() => {
		setCanPersistWorkspaceState(false);
		setSelectedTaskId(null);
		setIsGitHistoryOpen(false);
		setIsMobileSidebarOpen(false);
		setPendingTaskStartAfterEditId(null);
		taskEditorResetRef.current();
	}, []);
	const {
		currentProjectId,
		projects,
		workspaceState: streamedWorkspaceState,
		workspaceMetadata,
		latestTaskChatMessage,
		taskChatMessagesByTaskId,
		latestTaskReadyForReview,
		latestMcpAuthStatuses,
		clineSessionContextVersion,
		streamError,
		isRuntimeDisconnected,
		hasReceivedSnapshot,
		navigationCurrentProjectId,
		removingProjectId,
		hasNoProjects,
		isProjectSwitching,
		handleSelectProject,
		handleAddProject,
		handleConfirmInitializeGitProject,
		handleCancelInitializeGitProject,
		handleRemoveProject,
		pendingGitInitializationPath,
		isInitializingGitProject,
		resetProjectNavigationState,
	} = useProjectNavigation({
		onProjectSwitchStart: handleProjectSwitchStart,
	});
	const activeNotificationWorkspaceId = navigationCurrentProjectId;
	const isDocumentVisible = useDocumentVisibility();
	const isInitialRuntimeLoad =
		!hasReceivedSnapshot && currentProjectId === null && projects.length === 0 && !streamError;
	const isAwaitingWorkspaceSnapshot = currentProjectId !== null && streamedWorkspaceState === null;
	const {
		config: runtimeProjectConfig,
		isLoading: isRuntimeProjectConfigLoading,
		refresh: refreshRuntimeProjectConfig,
	} = useRuntimeProjectConfig(currentProjectId);
	const { isBlocked: isKanbanAccessBlocked } = useKanbanAccessGate({
		workspaceId: currentProjectId,
	});
	const isTaskAgentReady = isTaskAgentSetupSatisfied(runtimeProjectConfig);
	const settingsWorkspaceId = navigationCurrentProjectId ?? currentProjectId;
	const { config: settingsRuntimeProjectConfig, refresh: refreshSettingsRuntimeProjectConfig } =
		useRuntimeProjectConfig(settingsWorkspaceId);
	const {
		isStartupOnboardingDialogOpen,
		handleOpenStartupOnboardingDialog,
		handleCloseStartupOnboardingDialog,
		handleSelectOnboardingAgent,
		handleOnboardingClineSetupSaved,
	} = useStartupOnboarding({
		currentProjectId,
		runtimeProjectConfig,
		isRuntimeProjectConfigLoading,
		isTaskAgentReady,
		refreshRuntimeProjectConfig,
		refreshSettingsRuntimeProjectConfig,
	});
	const {
		debugModeEnabled,
		isDebugDialogOpen,
		isResetAllStatePending,
		handleOpenDebugDialog,
		handleShowStartupOnboardingDialog,
		handleDebugDialogOpenChange,
		handleResetAllState,
	} = useDebugTools({
		runtimeProjectConfig,
		settingsRuntimeProjectConfig,
		onOpenStartupOnboardingDialog: handleOpenStartupOnboardingDialog,
	});
	const {
		markConnectionReady: markTerminalConnectionReady,
		prepareWaitForConnection: prepareWaitForTerminalConnectionReady,
	} = useTerminalConnectionReady();
	const readyForReviewNotificationsEnabled = runtimeProjectConfig?.readyForReviewNotificationsEnabled ?? true;
	const shortcuts = runtimeProjectConfig?.shortcuts ?? [];
	const selectedShortcutLabel = useMemo(() => {
		if (shortcuts.length === 0) {
			return null;
		}
		const configured = runtimeProjectConfig?.selectedShortcutLabel ?? null;
		if (configured && shortcuts.some((shortcut) => shortcut.label === configured)) {
			return configured;
		}
		return shortcuts[0]?.label ?? null;
	}, [runtimeProjectConfig?.selectedShortcutLabel, shortcuts]);
	const {
		upsertSession,
		ensureTaskWorkspace,
		startTaskSession,
		stopTaskSession,
		sendTaskSessionInput,
		sendTaskChatMessage,
		cancelTaskChatTurn,
		fetchTaskChatMessages,
		cleanupTaskWorkspace,
		fetchTaskWorkspaceInfo,
	} = useTaskSessions({
		currentProjectId,
		setSessions,
	});

	const { chatsByProject } = useProjectAgentChats({
		currentProjectId,
		board,
	});

	const selectedCard = null;
	const boardSelection = null;

	const {
		workspacePath,
		workspaceGit,
		workspaceRevision,
		setWorkspaceRevision,
		workspaceHydrationNonce,
		isWorkspaceStateRefreshing,
		isWorkspaceMetadataPending,
		refreshWorkspaceState,
		resetWorkspaceSyncState,
	} = useWorkspaceSync({
		currentProjectId,
		streamedWorkspaceState,
		hasNoProjects,
		hasReceivedSnapshot,
		isDocumentVisible,
		setBoard,
		setSessions,
		setCanPersistWorkspaceState,
	});

	useEffect(() => {
		replaceWorkspaceMetadata(workspaceMetadata);
	}, [workspaceMetadata]);

	useEffect(() => {
		if (!isProjectSwitching) {
			return;
		}
		resetWorkspaceMetadataStore();
	}, [isProjectSwitching]);

	const {
		displayedProjects,
		navigationProjectPath,
		shouldShowProjectLoadingState,
		isProjectListLoading,
		shouldUseNavigationPath,
	} = useProjectUiState({
		board,
		canPersistWorkspaceState,
		currentProjectId,
		projects,
		navigationCurrentProjectId,
		selectedTaskId,
		streamError,
		isProjectSwitching,
		isInitialRuntimeLoad,
		isAwaitingWorkspaceSnapshot,
		isWorkspaceMetadataPending,
		hasReceivedSnapshot,
	});

	useReviewReadyNotifications({
		activeWorkspaceId: activeNotificationWorkspaceId,
		board,
		isDocumentVisible,
		latestTaskReadyForReview,
		taskSessions: sessions,
		readyForReviewNotificationsEnabled,
		workspacePath,
	});

	const { createTaskBranchOptions, defaultTaskBranchRef } = useTaskBranchOptions({ workspaceGit });
	const queueTaskStartAfterEdit = useCallback((taskId: string) => {
		setPendingTaskStartAfterEditId(taskId);
	}, []);

	const {
		isInlineTaskCreateOpen,
		newTaskPrompt,
		setNewTaskPrompt,
		newTaskImages,
		setNewTaskImages,
		newTaskStartInPlanMode,
		setNewTaskStartInPlanMode,
		newTaskAutoReviewEnabled,
		setNewTaskAutoReviewEnabled,
		newTaskAutoReviewMode,
		setNewTaskAutoReviewMode,
		isNewTaskStartInPlanModeDisabled,
		newTaskBranchRef,
		setNewTaskBranchRef,
		editingTaskId,
		editTaskPrompt,
		setEditTaskPrompt,
		editTaskImages,
		setEditTaskImages,
		editTaskStartInPlanMode,
		setEditTaskStartInPlanMode,
		editTaskAutoReviewEnabled,
		setEditTaskAutoReviewEnabled,
		editTaskAutoReviewMode,
		setEditTaskAutoReviewMode,
		isEditTaskStartInPlanModeDisabled,
		editTaskBranchRef,
		setEditTaskBranchRef,
		handleOpenCreateTask,
		handleCancelCreateTask,
		handleOpenEditTask,
		handleCancelEditTask,
		handleSaveEditedTask,
		handleSaveAndStartEditedTask,
		handleCreateTask,
		handleCreateTasks,
		resetTaskEditorState,
	} = useTaskEditor({
		board,
		setBoard,
		currentProjectId,
		createTaskBranchOptions,
		defaultTaskBranchRef,
		selectedAgentId: runtimeProjectConfig?.selectedAgentId ?? null,
		setSelectedTaskId,
		queueTaskStartAfterEdit,
	});

	useEffect(() => {
		taskEditorResetRef.current = resetTaskEditorState;
	}, [resetTaskEditorState]);

	useEffect(() => {
		if (!isProjectSwitching) {
			return;
		}
		resetWorkspaceSyncState();
	}, [isProjectSwitching, resetWorkspaceSyncState]);

	useEffect(() => {
		if (!isProjectSwitching) {
			return;
		}
		resetTaskEditorState();
	}, [isProjectSwitching, resetTaskEditorState]);

	const reviewGitActionHoldTaskIdsRef = useRef(new Set<string>());
	const registerReviewGitActionHold = useCallback((taskId: string) => {
		reviewGitActionHoldTaskIdsRef.current.add(taskId);
	}, []);

	const {
		runningGitAction,
		taskGitActionLoadingByTaskId,
		commitTaskLoadingById,
		openPrTaskLoadingById,
		agentCommitTaskLoadingById,
		agentOpenPrTaskLoadingById,
		isDiscardingHomeWorkingChanges,
		gitActionError,
		gitActionErrorTitle,
		clearGitActionError,
		gitHistory,
		runGitAction,
		switchHomeBranch,
		discardHomeWorkingChanges,
		handleCommitTask,
		handleOpenPrTask,
		handleAgentCommitTask,
		handleAgentOpenPrTask,
		runAutoReviewGitAction,
		resetGitActionState,
	} = useGitActions({
		currentProjectId,
		board,
		selectedCard,
		runtimeProjectConfig,
		sendTaskSessionInput,
		sendTaskChatMessage,
		fetchTaskWorkspaceInfo,
		isGitHistoryOpen,
		refreshWorkspaceState,
		registerReviewGitActionHold,
	});
	const agentCommand = runtimeProjectConfig?.effectiveCommand ?? null;
	const {
		homeTerminalTaskId,
		isHomeTerminalOpen,
		isHomeTerminalStarting,
		homeTerminalPaneHeight,
		isDetailTerminalOpen,
		detailTerminalTaskId,
		isDetailTerminalStarting,
		detailTerminalPaneHeight,
		isHomeTerminalExpanded,
		isDetailTerminalExpanded,
		setHomeTerminalPaneHeight,
		setDetailTerminalPaneHeight,
		handleToggleExpandHomeTerminal,
		handleToggleExpandDetailTerminal,
		handleToggleHomeTerminal,
		handleToggleDetailTerminal,
		handleSendAgentCommandToHomeTerminal,
		handleSendAgentCommandToDetailTerminal,
		prepareTerminalForShortcut,
		closeHomeTerminal,
		closeDetailTerminal,
		resetTerminalPanelsState,
	} = useTerminalPanels({
		currentProjectId,
		selectedCard,
		workspaceGit,
		agentCommand,
		upsertSession,
		sendTaskSessionInput,
	});
	usePrewarmedAgentTerminals({
		currentProjectId,
		isWorkspaceReady: !isWorkspaceMetadataPending,
		isRuntimeDisconnected,
		board,
		sessions,
		cursorColor: TERMINAL_THEME_COLORS.textPrimary,
		terminalBackgroundColor: TERMINAL_THEME_COLORS.surfacePrimary,
	});
	const homeTerminalSummary = sessions[homeTerminalTaskId] ?? null;

	const handleCreateNewChat = useCallback(() => {
		const baseRef = defaultTaskBranchRef ?? "main";
		const created = addTaskToColumnWithResult(board, "backlog", {
			prompt: "",
			baseRef,
		});
		setBoard(created.board);
		setHomeSidebarSection("projects");
		setSelectedTaskId(created.task.id);
		setPendingNewChatStartId(created.task.id);
	}, [board, defaultTaskBranchRef, setBoard]);

	const handleReturnToPhuong = useCallback(() => {
		setSelectedTaskId(null);
		setHomeSidebarSection("agent");
	}, []);

	const homeProjectAgentChatPanel = useHomeProjectAgentChatPanel({
		currentProjectId,
		hasNoProjects,
		runtimeProjectConfig,
		board,
		selectedTaskId,
		homeSurfaceMode: homeSidebarSection === "agent" && !selectedTaskId ? "conduit" : "dashboard",
		taskSessions: sessions,
		clineSessionContextVersion,
		latestTaskChatMessage,
		taskChatMessagesByTaskId,
		onSessionSummary: upsertSession,
		onCreateNewChat: handleCreateNewChat,
		onReturnToPhuong: handleReturnToPhuong,
	});
	const { runningShortcutLabel, handleSelectShortcutLabel, handleRunShortcut, handleCreateShortcut } = useShortcutActions({
		currentProjectId,
		selectedShortcutLabel: runtimeProjectConfig?.selectedShortcutLabel,
		shortcuts,
		refreshRuntimeProjectConfig,
		prepareTerminalForShortcut,
		prepareWaitForTerminalConnectionReady,
		sendTaskSessionInput,
	});

	const persistWorkspaceStateAsync = useCallback(
		async (input: { workspaceId: string; payload: Parameters<typeof saveWorkspaceState>[1] }) =>
			await saveWorkspaceState(input.workspaceId, input.payload),
		[],
	);
	const handleWorkspaceStateConflict = useCallback(() => {
		showAppToast(
			{
				intent: "warning",
				icon: "warning-sign",
				message: "Workspace changed elsewhere. Synced latest state. Retry your last edit if needed.",
				timeout: 5000,
			},
			"workspace-state-conflict",
		);
	}, []);

	useWorkspacePersistence({
		board,
		sessions,
		currentProjectId,
		workspaceRevision,
		hydrationNonce: workspaceHydrationNonce,
		canPersistWorkspaceState,
		isDocumentVisible,
		isWorkspaceStateRefreshing,
		persistWorkspaceState: persistWorkspaceStateAsync,
		refetchWorkspaceState: refreshWorkspaceState,
		onWorkspaceRevisionChange: setWorkspaceRevision,
		onWorkspaceStateConflict: handleWorkspaceStateConflict,
	});

	useEffect(() => {
		if (!streamError) {
			lastStreamErrorRef.current = null;
			return;
		}
		const removedPath = parseRemovedProjectPathFromStreamError(streamError);
		if (removedPath !== null) {
			showAppToast(
				{
					intent: "danger",
					icon: "warning-sign",
					message: removedPath
						? `Project no longer exists and was removed: ${removedPath}`
						: "Project no longer exists and was removed.",
					timeout: 6000,
				},
				`project-removed-${removedPath || "unknown"}`,
			);
			lastStreamErrorRef.current = null;
			return;
		}
		if (isRuntimeDisconnected) {
			lastStreamErrorRef.current = streamError;
			return;
		}
		if (lastStreamErrorRef.current !== streamError) {
			notifyError(streamError, { key: `error:${streamError}` });
		}
		lastStreamErrorRef.current = streamError;
	}, [isRuntimeDisconnected, streamError]);

	useEffect(() => {
		setSelectedTaskId(null);
		resetTaskEditorState();
		setIsClearTrashDialogOpen(false);
		resetGitActionState();
		resetProjectNavigationState();
		resetTerminalPanelsState();
	}, [
		currentProjectId,
		resetGitActionState,
		resetProjectNavigationState,
		resetTaskEditorState,
		resetTerminalPanelsState,
	]);

	useEffect(() => {
		if (!selectedTaskId) {
			return;
		}
		if (!findCardSelection(board, selectedTaskId)) {
			setSelectedTaskId(null);
		}
	}, [board, selectedTaskId]);

	useEffect(() => {
		if (selectedCard) {
			return;
		}
		if (hasNoProjects || !currentProjectId) {
			if (isHomeTerminalOpen) {
				closeHomeTerminal();
			}
			return;
		}
	}, [closeHomeTerminal, currentProjectId, hasNoProjects, isHomeTerminalOpen, selectedCard]);
	const showHomeBottomTerminal = !selectedCard && !hasNoProjects && isHomeTerminalOpen;
	const homeTerminalSubtitle = useMemo(
		() => workspacePath ?? navigationProjectPath ?? null,
		[navigationProjectPath, workspacePath],
	);

	const handleToggleMobileSidebar = useCallback(() => {
		setIsMobileSidebarOpen((prev) => !prev);
	}, []);
	const handleCloseMobileSidebar = useCallback(() => {
		setIsMobileSidebarOpen(false);
	}, []);

	const handleBack = useCallback(() => {
		setSelectedTaskId(null);
		setIsGitHistoryOpen(false);
		setHomeSidebarSection("agent");
	}, []);

	const handleSelectAgentChatFromSidebar = useCallback(
		(projectId: string, taskId: string) => {
			if (navigationCurrentProjectId !== projectId) {
				void handleSelectProject(projectId);
			}
			setHomeSidebarSection("projects");
			setSelectedTaskId(taskId);
		},
		[handleSelectProject, navigationCurrentProjectId],
	);

	const handleHomeSidebarSectionChange = useCallback((section: "projects" | "agent") => {
		setHomeSidebarSection(section);
		if (section === "agent") {
			setSelectedTaskId(null);
			setIsGitHistoryOpen(false);
		}
	}, []);

	const handleOpenSettings = useCallback((section?: RuntimeSettingsSection) => {
		setSettingsInitialSection(section ?? null);
		setIsSettingsOpen(true);
	}, []);
	const handleToggleGitHistory = useCallback(() => {
		if (hasNoProjects) {
			return;
		}
		setIsGitHistoryOpen((current) => !current);
	}, [hasNoProjects]);
	const handleCloseGitHistory = useCallback(() => {
		setIsGitHistoryOpen(false);
	}, []);

	const {
		handleProgrammaticCardMoveReady,
		handleCreateDependency,
		handleDeleteDependency,
		handleDragEnd,
		handleStartTask,
		handleStartAllBacklogTasks,
		handleDetailTaskDragEnd,
		handleCardSelect,
		handleMoveToTrash,
		handleMoveReviewCardToTrash,
		handleRestoreTaskFromTrash,
		handleCancelAutomaticTaskAction,
		handleOpenClearTrash,
		handleConfirmClearTrash,
		handleAddReviewComments,
		handleSendReviewComments,
		moveToTrashLoadingById,
		trashTaskCount,
	} = useBoardInteractions({
		board,
		setBoard,
		sessions,
		setSessions,
		selectedCard,
		selectedTaskId,
		currentProjectId,
		setSelectedTaskId,
		setIsClearTrashDialogOpen,
		setIsGitHistoryOpen,
		stopTaskSession,
		cleanupTaskWorkspace,
		ensureTaskWorkspace,
		startTaskSession,
		fetchTaskWorkspaceInfo,
		sendTaskSessionInput,
		readyForReviewNotificationsEnabled,
		taskGitActionLoadingByTaskId,
		runAutoReviewGitAction,
		reviewGitActionHoldTaskIdsRef,
	});

	const {
		handleCreateAndStartTask,
		handleCreateAndStartTasks,
		handleCreateStartAndOpenTask,
		handleStartTaskFromBoard,
		handleStartAllBacklogTasksFromBoard,
	} = useTaskStartActions({
		board,
		handleCreateTask,
		handleCreateTasks,
		handleStartTask,
		handleStartAllBacklogTasks,
		setSelectedTaskId,
	});

	useAppHotkeys({
		selectedCard,
		isDetailTerminalOpen,
		isHomeTerminalOpen: showHomeBottomTerminal,
		isHomeGitHistoryOpen: !selectedCard && isGitHistoryOpen,
		canUseCreateTaskShortcut: !hasNoProjects && currentProjectId !== null,
		handleToggleDetailTerminal,
		handleToggleHomeTerminal,
		handleToggleExpandDetailTerminal,
		handleToggleExpandHomeTerminal: handleToggleExpandHomeTerminal,
		handleOpenCreateTask,
		handleOpenSettings,
		handleToggleGitHistory,
		handleCloseGitHistory,
		onStartAllTasks: handleStartAllBacklogTasksFromBoard,
	});

	useEffect(() => {
		if (!pendingTaskStartAfterEditId) {
			return;
		}
		const selection = findCardSelection(board, pendingTaskStartAfterEditId);
		if (!selection || selection.column.id !== "backlog") {
			return;
		}
		handleStartTaskFromBoard(pendingTaskStartAfterEditId);
		setPendingTaskStartAfterEditId(null);
	}, [board, handleStartTaskFromBoard, pendingTaskStartAfterEditId]);

	useEffect(() => {
		if (!pendingNewChatStartId) {
			return;
		}
		const selection = findCardSelection(board, pendingNewChatStartId);
		if (!selection || selection.column.id !== "backlog") {
			return;
		}
		handleStartTaskFromBoard(pendingNewChatStartId);
		setPendingNewChatStartId(null);
	}, [board, handleStartTaskFromBoard, pendingNewChatStartId]);

	const detailTerminalSummary = detailTerminalTaskId ? (sessions[detailTerminalTaskId] ?? null) : null;

	const runtimeHint = useMemo(() => {
		return getTaskAgentNavbarHint(runtimeProjectConfig, {
			shouldUseNavigationPath,
		});
	}, [runtimeProjectConfig, shouldUseNavigationPath]);

	const activeWorkspacePath = shouldUseNavigationPath
		? (navigationProjectPath ?? undefined)
		: (workspacePath ?? undefined);

	const navbarWorkspacePath = hasNoProjects ? undefined : activeWorkspacePath;
	const navbarRuntimeHint = hasNoProjects ? undefined : runtimeHint;
	const shouldHideProjectDependentTopBarActions =
		isProjectSwitching || isAwaitingWorkspaceSnapshot || isWorkspaceMetadataPending;

	const {
		openTargetOptions,
		selectedOpenTargetId,
		onSelectOpenTarget,
		onOpenWorkspace,
		canOpenWorkspace,
		isOpeningWorkspace,
	} = useOpenWorkspace({
		currentProjectId,
		workspacePath: activeWorkspacePath,
	});
	const handleCreateDialogOpenChange = useCallback(
		(open: boolean) => {
			if (!open) {
				handleCancelCreateTask();
			}
		},
		[handleCancelCreateTask],
	);

	const inlineTaskEditor = editingTaskId ? (
		<TaskInlineCreateCard
			prompt={editTaskPrompt}
			onPromptChange={setEditTaskPrompt}
			images={editTaskImages}
			onImagesChange={setEditTaskImages}
			onCreate={handleSaveEditedTask}
			onCreateAndStart={handleSaveAndStartEditedTask}
			onCancel={handleCancelEditTask}
			startInPlanMode={editTaskStartInPlanMode}
			onStartInPlanModeChange={setEditTaskStartInPlanMode}
			startInPlanModeDisabled={isEditTaskStartInPlanModeDisabled}
			autoReviewEnabled={editTaskAutoReviewEnabled}
			onAutoReviewEnabledChange={setEditTaskAutoReviewEnabled}
			autoReviewMode={editTaskAutoReviewMode}
			onAutoReviewModeChange={setEditTaskAutoReviewMode}
			workspaceId={currentProjectId}
			branchRef={editTaskBranchRef}
			branchOptions={createTaskBranchOptions}
			onBranchRefChange={setEditTaskBranchRef}
			mode="edit"
			idPrefix={`inline-edit-task-${editingTaskId}`}
		/>
	) : undefined;

	if (isRuntimeDisconnected) {
		return <RuntimeDisconnectedFallback />;
	}
	if (isKanbanAccessBlocked) {
		return <KanbanAccessBlockedFallback />;
	}

	return (
		<div className="flex h-[100svh] min-w-0 overflow-hidden">
			<ProjectNavigationPanel
				projects={displayedProjects}
				isLoadingProjects={isProjectListLoading}
				currentProjectId={navigationCurrentProjectId}
				removingProjectId={removingProjectId}
				activeSection={homeSidebarSection}
				onActiveSectionChange={handleHomeSidebarSectionChange}
				canShowAgentSection={!hasNoProjects && Boolean(currentProjectId)}
				chatsByProject={chatsByProject}
				selectedTaskId={selectedTaskId}
				onSelectProject={(projectId) => {
					void handleSelectProject(projectId);
				}}
				onSelectAgentChat={handleSelectAgentChatFromSidebar}
				onCreateNewChat={handleCreateNewChat}
				onRemoveProject={handleRemoveProject}
				onAddProject={() => {
					void handleAddProject();
				}}
				isMobile={isMobile}
				isMobileOpen={isMobileSidebarOpen}
				onMobileClose={handleCloseMobileSidebar}
			/>
			<div className="flex flex-col flex-1 min-w-0 overflow-hidden">
				<TopBar
					onBack={selectedTaskId ? handleBack : undefined}
					workspacePath={navbarWorkspacePath}
					isWorkspacePathLoading={shouldShowProjectLoadingState}
					workspaceHint={undefined}
					runtimeHint={navbarRuntimeHint}
					selectedTaskId={null}
					selectedTaskBaseRef={null}
					showHomeGitSummary={!hasNoProjects}
					runningGitAction={hasNoProjects ? null : runningGitAction}
					onGitFetch={() => { void runGitAction("fetch"); }}
					onGitPull={() => { void runGitAction("pull"); }}
					onGitPush={() => { void runGitAction("push"); }}
					onToggleTerminal={hasNoProjects ? undefined : handleToggleHomeTerminal}
					isTerminalOpen={showHomeBottomTerminal}
					isTerminalLoading={isHomeTerminalStarting}
					onOpenSettings={handleOpenSettings}
					showDebugButton={debugModeEnabled}
					onOpenDebugDialog={debugModeEnabled ? handleOpenDebugDialog : undefined}
					shortcuts={shortcuts}
					selectedShortcutLabel={selectedShortcutLabel}
					onSelectShortcutLabel={handleSelectShortcutLabel}
					runningShortcutLabel={runningShortcutLabel}
					onRunShortcut={handleRunShortcut}
					onCreateFirstShortcut={currentProjectId ? handleCreateShortcut : undefined}
					openTargetOptions={openTargetOptions}
					selectedOpenTargetId={selectedOpenTargetId}
					onSelectOpenTarget={onSelectOpenTarget}
					onOpenWorkspace={onOpenWorkspace}
					canOpenWorkspace={canOpenWorkspace}
					isOpeningWorkspace={isOpeningWorkspace}
					onToggleGitHistory={hasNoProjects ? undefined : handleToggleGitHistory}
					isGitHistoryOpen={isGitHistoryOpen}
					hideProjectDependentActions={shouldHideProjectDependentTopBarActions}
					isMobile={isMobile}
					onToggleMobileSidebar={handleToggleMobileSidebar}
				/>
				<div className="relative flex flex-1 min-h-0 min-w-0 overflow-hidden">
					<div className="kb-home-layout">
						{shouldShowProjectLoadingState ? (
							<div className="flex flex-1 min-h-0 items-center justify-center bg-surface-0">
								<Spinner size={30} />
							</div>
						) : hasNoProjects ? (
							<div className="flex flex-1 min-h-0 items-center justify-center bg-surface-0 p-6">
								<div className="flex flex-col items-center justify-center gap-3 text-text-tertiary">
									<FolderOpen size={48} strokeWidth={1} />
									<h3 className="text-sm font-semibold text-text-primary">No projects yet</h3>
									<p className="text-[13px] text-text-secondary">
										Add a git repository to start using Kanban.
									</p>
									<Button
										variant="primary"
										onClick={() => {
											void handleAddProject();
										}}
									>
										Add Project
									</Button>
								</div>
							</div>
						) : (
							<div className="flex flex-1 flex-col min-h-0 min-w-0">
								<div className="flex flex-1 min-h-0 min-w-0">
									{isGitHistoryOpen ? (
										<GitHistoryView
											workspaceId={currentProjectId}
											gitHistory={gitHistory}
											onCheckoutBranch={(branch) => {
												void switchHomeBranch(branch);
											}}
											onDiscardWorkingChanges={() => {
												void discardHomeWorkingChanges();
											}}
											isDiscardWorkingChangesPending={isDiscardingHomeWorkingChanges}
										/>
									) : (
										<div className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden">
											{homeProjectAgentChatPanel}
										</div>
									)}
								</div>
								{showHomeBottomTerminal ? (
									<ResizableBottomPane
										minHeight={200}
										initialHeight={homeTerminalPaneHeight}
										onHeightChange={setHomeTerminalPaneHeight}
									>
										<div
											style={{
												display: "flex",
												flex: "1 1 0",
												minWidth: 0,
												paddingLeft: 12,
												paddingRight: 12,
											}}
										>
											<AgentTerminalPanel
												key={`home-shell-${homeTerminalTaskId}`}
												taskId={homeTerminalTaskId}
												workspaceId={currentProjectId}
												summary={homeTerminalSummary}
												onSummary={upsertSession}
												showSessionToolbar={false}
												autoFocus
												onClose={closeHomeTerminal}
												minimalHeaderTitle="Terminal"
												minimalHeaderSubtitle={homeTerminalSubtitle}
												panelBackgroundColor={TERMINAL_THEME_COLORS.surfaceRaised}
												terminalBackgroundColor={TERMINAL_THEME_COLORS.surfaceRaised}
												cursorColor={TERMINAL_THEME_COLORS.textPrimary}
												showRightBorder={false}
												onConnectionReady={markTerminalConnectionReady}
												agentCommand={agentCommand}
												onSendAgentCommand={handleSendAgentCommandToHomeTerminal}
												isExpanded={isHomeTerminalExpanded}
												onToggleExpand={handleToggleExpandHomeTerminal}
											/>
										</div>
									</ResizableBottomPane>
								) : null}
							</div>
						)}
					</div>
				</div>
			</div>
			<RuntimeSettingsDialog
				open={isSettingsOpen}
				workspaceId={settingsWorkspaceId}
				initialConfig={settingsRuntimeProjectConfig}
				liveMcpAuthStatuses={latestMcpAuthStatuses}
				initialSection={settingsInitialSection}
				onOpenChange={(nextOpen) => {
					setIsSettingsOpen(nextOpen);
					if (!nextOpen) {
						setSettingsInitialSection(null);
					}
				}}
				onSaved={() => {
					refreshRuntimeProjectConfig();
					refreshSettingsRuntimeProjectConfig();
				}}
			/>
			<DebugDialog
				open={isDebugDialogOpen}
				onOpenChange={handleDebugDialogOpenChange}
				isResetAllStatePending={isResetAllStatePending}
				onShowStartupOnboardingDialog={handleShowStartupOnboardingDialog}
				onResetAllState={handleResetAllState}
			/>
			<TaskCreateDialog
				open={isInlineTaskCreateOpen}
				onOpenChange={handleCreateDialogOpenChange}
				prompt={newTaskPrompt}
				onPromptChange={setNewTaskPrompt}
				images={newTaskImages}
				onImagesChange={setNewTaskImages}
				onCreate={handleCreateTask}
				onCreateAndStart={handleCreateAndStartTask}
				onCreateStartAndOpen={handleCreateStartAndOpenTask}
				onCreateMultiple={handleCreateTasks}
				onCreateAndStartMultiple={handleCreateAndStartTasks}
				startInPlanMode={newTaskStartInPlanMode}
				onStartInPlanModeChange={setNewTaskStartInPlanMode}
				startInPlanModeDisabled={isNewTaskStartInPlanModeDisabled}
				autoReviewEnabled={newTaskAutoReviewEnabled}
				onAutoReviewEnabledChange={setNewTaskAutoReviewEnabled}
				autoReviewMode={newTaskAutoReviewMode}
				onAutoReviewModeChange={setNewTaskAutoReviewMode}
				workspaceId={currentProjectId}
				branchRef={newTaskBranchRef}
				branchOptions={createTaskBranchOptions}
				onBranchRefChange={setNewTaskBranchRef}
			/>
			<ClearTrashDialog
				open={isClearTrashDialogOpen}
				taskCount={trashTaskCount}
				onCancel={() => setIsClearTrashDialogOpen(false)}
				onConfirm={handleConfirmClearTrash}
			/>
			<StartupOnboardingDialog
				open={isStartupOnboardingDialogOpen}
				onClose={handleCloseStartupOnboardingDialog}
				selectedAgentId={runtimeProjectConfig?.selectedAgentId ?? null}
				agents={runtimeProjectConfig?.agents ?? []}
				clineProviderSettings={runtimeProjectConfig?.clineProviderSettings ?? null}
				workspaceId={currentProjectId}
				runtimeConfig={runtimeProjectConfig ?? null}
				onSelectAgent={handleSelectOnboardingAgent}
				onClineSetupSaved={handleOnboardingClineSetupSaved}
			/>

			<AlertDialog
				open={pendingGitInitializationPath !== null}
				onOpenChange={(open) => {
					if (!open) {
						handleCancelInitializeGitProject();
					}
				}}
			>
				<AlertDialogHeader>
					<AlertDialogTitle>Initialize git repository?</AlertDialogTitle>
				</AlertDialogHeader>
				<AlertDialogBody>
					<AlertDialogDescription asChild>
						<div className="flex flex-col gap-3">
							<p>Cline requires git to manage worktrees for tasks. This folder is not a git repository yet.</p>
							{pendingGitInitializationPath ? (
								<p className="font-mono text-xs text-text-secondary break-all">
									{pendingGitInitializationPath}
								</p>
							) : null}
							<p>If you cancel, the project will not be added.</p>
						</div>
					</AlertDialogDescription>
				</AlertDialogBody>
				<AlertDialogFooter>
					<AlertDialogCancel asChild>
						<Button
							variant="default"
							disabled={isInitializingGitProject}
							onClick={handleCancelInitializeGitProject}
						>
							Cancel
						</Button>
					</AlertDialogCancel>
					<AlertDialogAction asChild>
						<Button
							variant="primary"
							disabled={isInitializingGitProject}
							onClick={() => {
								void handleConfirmInitializeGitProject();
							}}
						>
							{isInitializingGitProject ? (
								<>
									<Spinner size={14} />
									Initializing...
								</>
							) : (
								"Initialize git"
							)}
						</Button>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialog>

			<AlertDialog
				open={gitActionError !== null}
				onOpenChange={(open) => {
					if (!open) {
						clearGitActionError();
					}
				}}
			>
				<AlertDialogHeader>
					<AlertDialogTitle>{gitActionErrorTitle}</AlertDialogTitle>
				</AlertDialogHeader>
				<AlertDialogBody>
					<p>{gitActionError?.message}</p>
					{gitActionError?.output ? (
						<pre className="max-h-[220px] overflow-auto rounded-md bg-surface-0 p-3 font-mono text-xs text-text-secondary whitespace-pre-wrap">
							{gitActionError.output}
						</pre>
					) : null}
				</AlertDialogBody>
				<AlertDialogFooter className="justify-end">
					<AlertDialogAction asChild>
						<Button variant="default" onClick={clearGitActionError}>
							Close
						</Button>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialog>
		</div>
	);
}
