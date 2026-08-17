import { TrailEvent } from "@/components/trail/trail-event";
import type { RuntimeLedgerEvent } from "@/runtime/types";

export function TrailStream({
	events,
	emptyLabel = "No events yet.",
}: {
	events: RuntimeLedgerEvent[];
	emptyLabel?: string;
}): React.ReactElement {
	if (events.length === 0) {
		return (
			<div className="flex flex-1 min-h-0 items-center justify-center px-4 text-center text-[13px] text-text-tertiary">
				{emptyLabel}
			</div>
		);
	}

	return (
		<div className="h-full overflow-y-auto overscroll-contain py-1">
			{events.map((event) => (
				<div key={event.id} className="px-3 py-1">
					<TrailEvent event={event} />
				</div>
			))}
		</div>
	);
}
