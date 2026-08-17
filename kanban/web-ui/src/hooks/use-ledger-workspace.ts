import { useCallback, useEffect, useMemo, useState } from "react";

import { mergeLedgerEvents } from "@/components/trail/merge-ledger-events";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeAgentRun, RuntimeLedgerEvent, RuntimeOutcome } from "@/runtime/types";

interface UseLedgerWorkspaceInput {
	workspaceId: string | null;
	selectedOutcomeId: string | null;
	hubEventsByOutcomeId: Record<string, RuntimeLedgerEvent[]>;
	refreshNonce?: number;
}

export function useLedgerWorkspace({
	workspaceId,
	selectedOutcomeId,
	hubEventsByOutcomeId,
	refreshNonce = 0,
}: UseLedgerWorkspaceInput): {
	outcomes: RuntimeOutcome[];
	runs: RuntimeAgentRun[];
	events: RuntimeLedgerEvent[];
	isLoadingOutcomes: boolean;
	isLoadingTrail: boolean;
	refreshOutcomes: () => void;
} {
	const [outcomes, setOutcomes] = useState<RuntimeOutcome[]>([]);
	const [runs, setRuns] = useState<RuntimeAgentRun[]>([]);
	const [loadedEvents, setLoadedEvents] = useState<RuntimeLedgerEvent[]>([]);
	const [isLoadingOutcomes, setIsLoadingOutcomes] = useState(false);
	const [isLoadingTrail, setIsLoadingTrail] = useState(false);
	const [outcomesTick, setOutcomesTick] = useState(0);

	const refreshOutcomes = useCallback(() => {
		setOutcomesTick((current) => current + 1);
	}, []);

	useEffect(() => {
		if (!workspaceId) {
			setOutcomes([]);
			return;
		}
		let cancelled = false;
		setIsLoadingOutcomes(true);
		const client = getRuntimeTrpcClient(workspaceId);
		void client.ledger.listOutcomes
			.query({ projectId: workspaceId })
			.then((result) => {
				if (!cancelled) {
					setOutcomes(result.outcomes);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setOutcomes([]);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoadingOutcomes(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [workspaceId, outcomesTick, refreshNonce]);

	useEffect(() => {
		if (!workspaceId || !selectedOutcomeId) {
			setRuns([]);
			setLoadedEvents([]);
			setIsLoadingTrail(false);
			return;
		}
		let cancelled = false;
		setIsLoadingTrail(true);
		setLoadedEvents([]);
		const client = getRuntimeTrpcClient(workspaceId);
		void Promise.all([
			client.ledger.listRuns.query({ outcomeId: selectedOutcomeId }),
			client.ledger.listEvents.query({ outcomeId: selectedOutcomeId }),
		])
			.then(([runResult, eventResult]) => {
				if (cancelled) {
					return;
				}
				setRuns(runResult.runs);
				setLoadedEvents(eventResult.events);
			})
			.catch(() => {
				if (cancelled) {
					return;
				}
				setRuns([]);
				setLoadedEvents([]);
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoadingTrail(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [workspaceId, selectedOutcomeId, refreshNonce]);

	const events = useMemo(() => {
		if (!selectedOutcomeId) {
			return [];
		}
		return mergeLedgerEvents(loadedEvents, hubEventsByOutcomeId[selectedOutcomeId] ?? []);
	}, [hubEventsByOutcomeId, loadedEvents, selectedOutcomeId]);

	return {
		outcomes,
		runs,
		events,
		isLoadingOutcomes,
		isLoadingTrail,
		refreshOutcomes,
	};
}
