import { ClineMarkdownContent } from "@/components/detail-panels/cline-markdown-content";
import { TrailCard } from "@/components/trail/trail-card";
import { payloadNumber, payloadOneLiner, payloadString } from "@/components/trail/trail-payload";
import { TrailSpawnCard } from "@/components/trail/trail-spawn-card";
import { TrailStatusPill } from "@/components/trail/trail-status-pill";
import { TrailToolCard } from "@/components/trail/trail-tool-card";
import type { RuntimeLedgerEvent } from "@/runtime/types";

export function TrailEvent({ event }: { event: RuntimeLedgerEvent }): React.ReactElement {
	switch (event.kind) {
		case "user_message":
			return (
				<TrailCard kind="user_message" label="You" createdAt={event.createdAt} className="ml-6">
					<p className="text-sm leading-snug text-text-primary whitespace-pre-wrap break-words">
						{payloadString(event.payload, "text") ?? ""}
					</p>
				</TrailCard>
			);
		case "assistant_message":
			return (
				<TrailCard kind="assistant_message" label="Assistant" createdAt={event.createdAt}>
					<ClineMarkdownContent content={payloadString(event.payload, "text") ?? ""} />
				</TrailCard>
			);
		case "tool_call":
		case "tool_result":
			return <TrailToolCard event={event} />;
		case "spawn":
			return <TrailSpawnCard event={event} />;
		case "status": {
			const status = payloadString(event.payload, "status") ?? "status";
			const reason = payloadString(event.payload, "reason");
			return (
				<TrailCard kind="status" label="status" createdAt={event.createdAt}>
					<div className="flex flex-wrap items-center gap-2">
						<TrailStatusPill status={status} />
						{reason ? <span className="text-[12px] text-text-secondary">{reason}</span> : null}
					</div>
				</TrailCard>
			);
		}
		case "gate": {
			const command = payloadString(event.payload, "command") ?? "gate";
			const exitCode = payloadNumber(event.payload, "exitCode");
			const snippet = payloadOneLiner(event.payload.output);
			return (
				<TrailCard kind="gate" label="gate" createdAt={event.createdAt}>
					<p className="font-mono text-[12px] text-text-primary">
						{command}
						{exitCode !== null ? (
							<span className={exitCode === 0 ? "text-status-green" : "text-status-red"}> · exit {exitCode}</span>
						) : null}
					</p>
					{snippet ? <p className="mt-0.5 truncate font-mono text-[11px] text-text-tertiary">{snippet}</p> : null}
				</TrailCard>
			);
		}
		case "artifact": {
			const label = payloadString(event.payload, "label") ?? "artifact";
			const path = payloadString(event.payload, "path");
			return (
				<TrailCard kind="artifact" label="artifact" createdAt={event.createdAt}>
					<p className="text-[12px] text-text-primary">
						{label}
						{path ? <span className="ml-1.5 font-mono text-text-tertiary">{path}</span> : null}
					</p>
				</TrailCard>
			);
		}
		case "file_change": {
			const path = payloadString(event.payload, "path") ?? "file";
			const additions = payloadNumber(event.payload, "additions");
			const deletions = payloadNumber(event.payload, "deletions");
			return (
				<TrailCard kind="file_change" label="file" createdAt={event.createdAt}>
					<p className="font-mono text-[12px] text-text-primary">
						{path}
						{additions !== null ? <span className="ml-2 text-status-green">+{additions}</span> : null}
						{deletions !== null ? <span className="ml-1 text-status-red">−{deletions}</span> : null}
					</p>
				</TrailCard>
			);
		}
		default: {
			const text =
				payloadString(event.payload, "text") ??
				payloadString(event.payload, "message") ??
				payloadOneLiner(event.payload);
			return (
				<TrailCard kind="system" label="system" createdAt={event.createdAt}>
					<p className="text-[12px] text-text-tertiary">{text ?? event.kind}</p>
				</TrailCard>
			);
		}
	}
}
