import { cn } from "@/components/ui/cn";

const STATUS_CLASS: Record<string, string> = {
	DONE: "bg-status-green/15 text-status-green",
	DONE_WITH_CONCERNS: "bg-status-orange/15 text-status-orange",
	NEEDS_CONTEXT: "bg-status-orange/15 text-status-orange",
	BLOCKED: "bg-status-red/15 text-status-red",
	open: "bg-surface-3 text-text-secondary",
	in_progress: "bg-status-orange/15 text-status-orange",
	verifying: "bg-status-gold/15 text-status-gold",
	done: "bg-status-green/15 text-status-green",
	blocked: "bg-status-red/15 text-status-red",
	parked: "bg-surface-3 text-text-tertiary",
	queued: "bg-surface-3 text-text-secondary",
	running: "bg-status-orange/15 text-status-orange",
	failed: "bg-status-red/15 text-status-red",
	needs_context: "bg-status-orange/15 text-status-orange",
};

export function TrailStatusPill({
	status,
	pulse = false,
}: {
	status: string;
	pulse?: boolean;
}): React.ReactElement {
	return (
		<span
			className={cn(
				"inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[11px] font-medium uppercase",
				STATUS_CLASS[status] ?? "bg-surface-3 text-text-secondary",
				pulse && "animate-pulse",
			)}
		>
			{status.replaceAll("_", " ")}
		</span>
	);
}
