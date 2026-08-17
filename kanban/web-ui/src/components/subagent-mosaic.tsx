import { TrailStatusPill } from "@/components/trail/trail-status-pill";
import { TrailStream } from "@/components/trail/trail-stream";
import { cn } from "@/components/ui/cn";
import type { RuntimeAgentRun, RuntimeLedgerEvent, RuntimeOutcome } from "@/runtime/types";

export function mosaicColumnCount(paneCount: number): number {
	if (paneCount <= 1) {
		return 1;
	}
	if (paneCount === 2) {
		return 2;
	}
	if (paneCount <= 4) {
		return 2;
	}
	if (paneCount <= 9) {
		return 3;
	}
	return 4;
}

export function eventsForRun(events: RuntimeLedgerEvent[], runId: string): RuntimeLedgerEvent[] {
	return events.filter((event) => event.runId === runId);
}

function runPaneLabel(run: RuntimeAgentRun): string {
	const prompt = run.prompt.trim();
	if (prompt.length === 0) {
		return run.role === "worker" ? "Subagent" : run.role;
	}
	const firstLine = prompt.split("\n")[0] ?? prompt;
	return firstLine.length > 72 ? `${firstLine.slice(0, 72)}…` : firstLine;
}

export function SubagentMosaic({
	runs,
	events,
	outcomesById,
	onOpenRun,
}: {
	runs: RuntimeAgentRun[];
	events: RuntimeLedgerEvent[];
	outcomesById?: Record<string, RuntimeOutcome>;
	onOpenRun: (runId: string, outcomeId: string) => void;
}): React.ReactElement {
	if (runs.length === 0) {
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-[13px] text-text-tertiary">
				No subagents yet. Phuong will spawn them here.
			</div>
		);
	}

	const columns = mosaicColumnCount(runs.length);

	return (
		<div
			className="grid min-h-0 flex-1 gap-1.5 overflow-auto p-1.5"
			style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
		>
			{runs.map((run) => {
				const outcome = outcomesById?.[run.outcomeId];
				const runEvents = eventsForRun(events, run.id);
				return (
					<button
						key={run.id}
						type="button"
						onClick={() => onOpenRun(run.id, run.outcomeId)}
						className={cn(
							"flex min-h-[180px] min-w-0 flex-col overflow-hidden rounded-md border border-border bg-surface-1 text-left",
							"hover:border-border-bright hover:bg-surface-2",
						)}
					>
						<div className="flex shrink-0 items-start justify-between gap-2 border-b border-border px-2 py-1.5">
							<div className="min-w-0">
								<div className="truncate text-[12px] text-text-primary">{runPaneLabel(run)}</div>
								<div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-text-tertiary">
									<span>subagent</span>
									<span>{run.agent}</span>
									{run.tier ? <span>{run.tier}</span> : null}
									{outcome?.title ? <span className="truncate">{outcome.title}</span> : null}
								</div>
							</div>
							<TrailStatusPill status={run.status} pulse={run.status === "running"} />
						</div>
						<div className="min-h-0 flex-1 overflow-hidden">
							<TrailStream
								events={runEvents.slice(-8)}
								emptyLabel="Waiting for this subagent to start."
							/>
						</div>
					</button>
				);
			})}
		</div>
	);
}
