import { PhuongChatPanel } from "@/components/phuong/phuong-chat-panel";
import { SubagentMosaic } from "@/components/subagent-mosaic";
import { TrailStatusPill } from "@/components/trail/trail-status-pill";
import { cn } from "@/components/ui/cn";
import type { RuntimeAgentRun, RuntimeLedgerEvent, RuntimeOutcome } from "@/runtime/types";

export function TalkHomeView({
	workspaceId,
	outcomes,
	projectRuns,
	projectEvents,
	onSelectOutcome,
	onOpenRun,
}: {
	workspaceId: string;
	outcomes: RuntimeOutcome[];
	projectRuns: RuntimeAgentRun[];
	projectEvents: RuntimeLedgerEvent[];
	onSelectOutcome: (outcomeId: string) => void;
	onOpenRun: (runId: string, outcomeId: string) => void;
}): React.ReactElement {
	const outcomesById = Object.fromEntries(outcomes.map((outcome) => [outcome.id, outcome]));
	const activeRuns = projectRuns.filter((run) => run.status === "running" || run.status === "queued");
	const mosaicRuns = activeRuns.length > 0 ? activeRuns : projectRuns;

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-0">
			{outcomes.length > 0 ? (
				<div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-border bg-surface-1 px-3 py-1.5">
					{outcomes.map((outcome) => (
						<button
							key={outcome.id}
							type="button"
							onClick={() => onSelectOutcome(outcome.id)}
							className={cn(
								"inline-flex max-w-[220px] shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1 text-left",
								"hover:bg-surface-3",
							)}
						>
							<span className="truncate text-[12px] text-text-primary">{outcome.title || "Untitled"}</span>
							<TrailStatusPill status={outcome.status} />
						</button>
					))}
				</div>
			) : null}
			{mosaicRuns.length > 0 ? (
				<>
					<div className="min-h-0 flex-1">
						<SubagentMosaic
							runs={mosaicRuns}
							events={projectEvents}
							outcomesById={outcomesById}
							onOpenRun={onOpenRun}
						/>
					</div>
					<div className="h-[168px] shrink-0 border-t border-border">
						<PhuongChatPanel workspaceId={workspaceId} variant="compact" />
					</div>
				</>
			) : (
				<div className="flex min-h-0 flex-1 flex-col">
					<PhuongChatPanel workspaceId={workspaceId} variant="conduit" />
				</div>
			)}
		</div>
	);
}
