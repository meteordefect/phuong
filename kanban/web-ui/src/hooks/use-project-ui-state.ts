import { useMemo } from "react";
import type { RuntimeProjectSummary } from "@/runtime/types";

interface UseProjectUiStateInput {
	projects: RuntimeProjectSummary[];
	navigationCurrentProjectId: string | null;
	selectedTaskId: string | null;
	streamError: string | null;
	isProjectSwitching: boolean;
	isInitialRuntimeLoad: boolean;
	isAwaitingWorkspaceSnapshot: boolean;
	isWorkspaceMetadataPending: boolean;
	hasReceivedSnapshot: boolean;
}

interface UseProjectUiStateResult {
	displayedProjects: RuntimeProjectSummary[];
	navigationProjectPath: string | null;
	shouldShowProjectLoadingState: boolean;
	isProjectListLoading: boolean;
	shouldUseNavigationPath: boolean;
}

export function useProjectUiState({
	projects,
	navigationCurrentProjectId,
	selectedTaskId,
	streamError,
	isProjectSwitching,
	isInitialRuntimeLoad,
	isAwaitingWorkspaceSnapshot,
	isWorkspaceMetadataPending,
	hasReceivedSnapshot,
}: UseProjectUiStateInput): UseProjectUiStateResult {
	const displayedProjects = projects;

	const navigationProjectPath = useMemo(() => {
		if (!navigationCurrentProjectId) {
			return null;
		}
		return projects.find((project) => project.id === navigationCurrentProjectId)?.path ?? null;
	}, [navigationCurrentProjectId, projects]);

	const shouldShowProjectLoadingState =
		selectedTaskId === null &&
		!streamError &&
		(isProjectSwitching || isInitialRuntimeLoad || isAwaitingWorkspaceSnapshot || isWorkspaceMetadataPending);
	const isProjectListLoading = !hasReceivedSnapshot && !streamError;
	const shouldUseNavigationPath = isProjectSwitching || isAwaitingWorkspaceSnapshot || isWorkspaceMetadataPending;

	return {
		displayedProjects,
		navigationProjectPath,
		shouldShowProjectLoadingState,
		isProjectListLoading,
		shouldUseNavigationPath,
	};
}
