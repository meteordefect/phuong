import { useEffect, useState } from "react";

import { AgentTerminalPanel } from "@/components/detail-panels/agent-terminal-panel";
import { PhuongChatPanel } from "@/components/phuong/phuong-chat-panel";
import { SubagentMosaic } from "@/components/subagent-mosaic";
import { TrailStatusPill } from "@/components/trail/trail-status-pill";
import { TrailStream } from "@/components/trail/trail-stream";
import { Button } from "@/components/ui/button";
import { createIdleTaskSession } from "@/hooks/app-utils";
import type { RuntimeAgentRun, RuntimeLedgerEvent, RuntimeOutcome, RuntimeTaskSessionSummary } from "@/runtime/types";
import { TERMINAL_THEME_COLORS } from "@/terminal/theme-colors";

export function OutcomeWatchView({
	workspaceId,
	outcome,
	runs,
	events,
	isLoadingTrail,
	selectedRunId,
	onSelectRun,
	onReturnToFloor,
	taskSessions,
	onSessionSummary,
	onReturnToPhuong,
}: {
	workspaceId: string;
	outcome: RuntimeOutcome;
	runs: RuntimeAgentRun[];
	events: RuntimeLedgerEvent[];
	isLoadingTrail: boolean;
	selectedRunId: string | null;
	onSelectRun: (runId: string) => void;
	onReturnToFloor: () => void;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	onSessionSummary: (summary: RuntimeTaskSessionSummary) => void;
	onReturnToPhuong: () => void;
}): React.ReactElement {
	const [interjectUnlocked, setInterjectUnlocked] = useState(false);
	const [ptyOpen, setPtyOpen] = useState(true);
	const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null;
	const focusMode = selectedRun !== null;

	useEffect(() => {
		setInterjectUnlocked(false);
		setPtyOpen(true);
	}, [outcome.id, selectedRunId]);

	const watchOnly = !interjectUnlocked;
	const ptyTaskId = selectedRun?.id ?? null;
	const ptySummary = ptyTaskId ? (taskSessions[ptyTaskId] ?? createIdleTaskSession(ptyTaskId)) : null;
	const focusEvents = selectedRun ? events.filter((event) => event.runId === selectedRun.id || event.runId === null) : events;

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-0">
			<header className="shrink-0 border-b border-border bg-surface-1 px-3 py-2">
				<div className="flex items-start justify-between gap-2">
					<div className="min-w-0">
						<div className="flex flex-wrap items-center gap-2">
							<h1 className="truncate text-sm font-medium text-text-primary">{outcome.title || "Untitled"}</h1>
							<TrailStatusPill status={outcome.status} />
							{focusMode ? (
								<span className="font-mono text-[11px] text-text-tertiary">subagent {selectedRun.id}</span>
							) : (
								<span className="text-[11px] text-text-tertiary">
									{runs.length} {runs.length === 1 ? "subagent" : "subagents"}
								</span>
							)}
						</div>
						{outcome.description ? (
							<p className="mt-0.5 line-clamp-2 text-[12px] text-text-secondary">{outcome.description}</p>
						) : null}
					</div>
					<div className="flex shrink-0 items-center gap-1.5">
						<Button variant="ghost" size="sm" onClick={onReturnToPhuong}>
							Phuong
						</Button>
						{focusMode ? (
							<Button variant="ghost" size="sm" onClick={onReturnToFloor}>
								Floor
							</Button>
						) : null}
						{focusMode && watchOnly ? (
							<Button variant="default" size="sm" onClick={() => setInterjectUnlocked(true)}>
								Interject
							</Button>
						) : null}
					</div>
				</div>
				{focusMode ? (
					watchOnly ? (
						<p className="mt-1.5 text-[11px] text-text-tertiary">
							Watching this subagent — Phuong is handling it. Interject only if you need to type.
						</p>
					) : (
						<p className="mt-1.5 text-[11px] text-status-orange">Interject unlocked — subagent input is available.</p>
					)
				) : (
					<p className="mt-1.5 text-[11px] text-text-tertiary">
						Floor — Phuong is running these subagents. Click a pane to work in it.
					</p>
				)}
			</header>

			{focusMode ? (
				<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
					<div className="min-h-0 flex-1">
						{isLoadingTrail && focusEvents.length === 0 ? (
							<div className="flex h-full items-center justify-center text-[13px] text-text-tertiary">
								Loading trail…
							</div>
						) : (
							<TrailStream events={focusEvents} emptyLabel="No trail yet for this subagent." />
						)}
					</div>
					<div className="h-[168px] shrink-0 border-t border-border">
						<PhuongChatPanel workspaceId={workspaceId} variant="compact" />
					</div>
					{ptyTaskId ? (
						<div className="shrink-0 border-t border-border bg-surface-1">
							<button
								type="button"
								className="flex w-full items-center justify-between px-3 py-1.5 text-[12px] text-text-secondary hover:text-text-primary"
								onClick={() => setPtyOpen((current) => !current)}
							>
								<span>Live terminal</span>
								<span className="font-mono text-[10px] text-text-tertiary">{ptyOpen ? "hide" : "show"}</span>
							</button>
							{ptyOpen ? (
								<div className="h-[220px] border-t border-border">
									<AgentTerminalPanel
										key={`${ptyTaskId}-${watchOnly ? "watch" : "interject"}`}
										taskId={ptyTaskId}
										workspaceId={workspaceId}
										terminalEnabled
										readOnly={watchOnly}
										onRequestInterject={() => setInterjectUnlocked(true)}
										onReturnToPhuong={onReturnToPhuong}
										summary={ptySummary}
										onSummary={onSessionSummary}
										showSessionToolbar={false}
										autoFocus={!watchOnly}
										showRightBorder={false}
										panelBackgroundColor={TERMINAL_THEME_COLORS.surfacePrimary}
										terminalBackgroundColor={TERMINAL_THEME_COLORS.surfacePrimary}
									/>
								</div>
							) : null}
						</div>
					) : null}
				</div>
			) : (
				<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
					<div className="min-h-0 flex-1">
						<SubagentMosaic
							runs={runs}
							events={events}
							onOpenRun={(runId) => onSelectRun(runId)}
						/>
					</div>
					<div className="h-[168px] shrink-0 border-t border-border">
						<PhuongChatPanel workspaceId={workspaceId} variant="compact" />
					</div>
				</div>
			)}
		</div>
	);
}
