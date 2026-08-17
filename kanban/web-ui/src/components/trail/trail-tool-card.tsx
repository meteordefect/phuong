import { useState } from "react";

import { TrailCard } from "@/components/trail/trail-card";
import { payloadBoolean, payloadOneLiner, payloadString } from "@/components/trail/trail-payload";
import { cn } from "@/components/ui/cn";
import type { RuntimeLedgerEvent } from "@/runtime/types";

export function TrailToolCard({ event }: { event: RuntimeLedgerEvent }): React.ReactElement {
	const [expanded, setExpanded] = useState(false);
	const isResult = event.kind === "tool_result";
	const name = payloadString(event.payload, "name") ?? "tool";
	const summary = isResult
		? payloadOneLiner(event.payload.result ?? event.payload.output)
		: payloadOneLiner(event.payload.args ?? event.payload.path);
	const isError = payloadBoolean(event.payload, "isError") === true;
	const detail = isResult
		? payloadString(event.payload, "result") ?? payloadString(event.payload, "output")
		: payloadOneLiner(event.payload.args, 2000);
	const canExpand = Boolean(detail && detail.length > 80);

	return (
		<TrailCard kind={event.kind} label={isResult ? "result" : "tool"} createdAt={event.createdAt}>
			<button
				type="button"
				className="flex w-full min-w-0 flex-col items-start gap-0.5 text-left"
				onClick={() => {
					if (canExpand) {
						setExpanded((current) => !current);
					}
				}}
				disabled={!canExpand}
			>
				<div className="flex min-w-0 items-baseline gap-2">
					<span className="font-mono text-[12px] text-status-blue">{name}</span>
					{isError ? <span className="font-mono text-[10px] text-status-red">error</span> : null}
				</div>
				{summary ? (
					<span
						className={cn(
							"w-full font-mono text-[11px] text-text-secondary",
							expanded ? "whitespace-pre-wrap break-words" : "truncate",
							isError && "text-status-red",
						)}
					>
						{expanded ? detail : summary}
					</span>
				) : null}
			</button>
		</TrailCard>
	);
}
