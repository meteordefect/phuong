import { TrailCard } from "@/components/trail/trail-card";
import { payloadString } from "@/components/trail/trail-payload";
import type { RuntimeLedgerEvent } from "@/runtime/types";

export function TrailSpawnCard({ event }: { event: RuntimeLedgerEvent }): React.ReactElement {
	const agent = payloadString(event.payload, "agent") ?? "pi";
	const tier = payloadString(event.payload, "tier");
	const model = payloadString(event.payload, "model");
	const runId = event.runId;
	return (
		<TrailCard kind="spawn" label="spawn" createdAt={event.createdAt}>
			<p className="font-mono text-[12px] text-text-primary">
				<span className="text-status-purple">{agent}</span>
				{tier ? <span className="text-text-secondary"> · {tier}</span> : null}
				{model ? <span className="text-text-tertiary"> · {model}</span> : null}
				{runId ? <span className="text-text-tertiary"> · {runId}</span> : null}
			</p>
		</TrailCard>
	);
}
