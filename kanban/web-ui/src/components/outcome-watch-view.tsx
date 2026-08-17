import { useEffect, useState } from "react";

import { AgentTerminalPanel } from "@/components/detail-panels/agent-terminal-panel";
import { PhuongChatPanel } from "@/components/phuong/phuong-chat-panel";
import { TrailStatusPill } from "@/components/trail/trail-status-pill";
import { TrailStream } from "@/components/trail/trail-stream";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
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
	onSelectRun: (runId: string | null) => void;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	onSessionSummary: (summary: RuntimeTaskSessionSummary) => void;
	onReturnToPhuong: () => void;
}): React.ReactElement {
	const [interjectUnlocked, setInterjectUnlocked] = useState(false);
	const [ptyOpen, setPtyOpen] = useState(false);

	useEffect(() => {
		setInterjectUnlocked(false);
		setPtyOpen(false);
	}, [outcome.id]);

	const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;
	const watchOnly = !interjectUnlocked;
	const ptyTaskId = selectedRun?.id ?? null;
	const ptySummary = ptyTaskId ? (taskSessions[ptyTaskId] ?? createIdleTaskSession(ptyTaskId)) : null;

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-0">
			<header className="shrink-0 border-b border-border bg-surface-1 px-3 py-2">
				<div className="flex items-start justify-between gap-2">
					<div className="min-w-0">
						<div className="flex flex-wrap items-center gap-2">
							<h1 className="truncate text-sm font-medium text-text-primary">{outcome.title || "Untitled"}</h1>
							<TrailStatusPill status={outcome.status} />
						</div>
						{outcome.description ? (
							<p className="mt-0.5 line-clamp-2 text-[12px] text-text-secondary">{outcome.description}</p>
						) : null}
					</div>
					<div className="flex shrink-0 items-center gap-1.5">
						<Button variant="ghost" size="sm" onClick={onReturnToPhuong}>
							Phuong
						</Button>
						{watchOnly ? (
							<Button variant="default" size="sm" onClick={() => setInterjectUnlocked(true)}>
								Interject
							</Button>
						) : null}
					</div>
				</div>
				{watchOnly ? (
					<p className="mt-1.5 text-[11px] text-text-tertiary">
						Watching — Phuong is handling this. Read-only by default. Interject only if you need to.
					</p>
				) : (
					<p className="mt-1.5 text-[11px] text-status-orange">Interject unlocked — worker input is available.</p>
				)}
			</header>

			<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
				<div className="min-h-0 flex-1">
					{isLoadingTrail && events.length === 0 ? (
						<div className="flex h-full items-center justify-center">
							<Spinner size={24} />
						</div>
					) : (
						<TrailStream events={events} emptyLabel="No trail yet. Events appear here as Phuong and workers work." />
					)}
				</div>

				{runs.length > 0 ? (
					<div className="flex shrink-0 gap-1.5 overflow-x-auto border-t border-border bg-surface-1 px-3 py-1.5">
						{runs.map((run) => {
							const isSelected = selectedRun?.id === run.id;
							return (
								<button
									key={run.id}
									type="button"
									onClick={() => onSelectRun(run.id)}
									className={cn(
										"inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1",
										isSelected ? "border-accent bg-surface-3" : "border-border bg-surface-2 hover:bg-surface-3",
									)}
								>
									<span className="font-mono text-[11px] text-text-primary">{run.role}</span>
									<span className="font-mono text-[10px] text-text-tertiary">{run.agent}</span>
									<TrailStatusPill status={run.status} pulse={run.status === "running"} />
								</button>
							);
						})}
					</div>
				) : null}

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
		</div>
	);
}
