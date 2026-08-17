import type { ReactNode } from "react";

import { cn } from "@/components/ui/cn";
import { formatTrailTime } from "@/components/trail/trail-payload";
import type { RuntimeLedgerEventKind } from "@/runtime/types";

const KIND_ACCENT: Record<RuntimeLedgerEventKind, string> = {
	user_message: "border-l-accent",
	assistant_message: "border-l-status-purple",
	tool_call: "border-l-status-blue",
	tool_result: "border-l-status-blue",
	status: "border-l-status-orange",
	gate: "border-l-status-green",
	artifact: "border-l-status-gold",
	file_change: "border-l-status-blue",
	spawn: "border-l-status-purple",
	system: "border-l-border-bright",
};

export function TrailCard({
	kind,
	label,
	createdAt,
	children,
	className,
}: {
	kind: RuntimeLedgerEventKind;
	label: string;
	createdAt: number;
	children: ReactNode;
	className?: string;
}): React.ReactElement {
	const time = formatTrailTime(createdAt);
	return (
		<article
			className={cn(
				"rounded-md border border-border bg-surface-2 border-l-2 px-2.5 py-1.5",
				KIND_ACCENT[kind],
				className,
			)}
			data-trail-kind={kind}
		>
			<div className="mb-1 flex items-baseline justify-between gap-2">
				<span className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">{label}</span>
				{time ? <time className="font-mono text-[10px] text-text-tertiary">{time}</time> : null}
			</div>
			{children}
		</article>
	);
}
