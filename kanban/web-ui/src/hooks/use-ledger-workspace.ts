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
	projectRuns: RuntimeAgentRun[];
	events: RuntimeLedgerEvent[];
	projectEvents: RuntimeLedgerEvent[];
	isLoadingOutcomes: boolean;
	isLoadingTrail: boolean;
	refreshOutcomes: () => void;
} {
	const [outcomes, setOutcomes] = useState<RuntimeOutcome[]>([]);
	const [runs, setRuns] = useState<RuntimeAgentRun[]>([]);
	const [projectRuns, setProjectRuns] = useState<RuntimeAgentRun[]>([]);
	const [loadedEvents, setLoadedEvents] = useState<RuntimeLedgerEvent[]>([]);
	const [loadedProjectEvents, setLoadedProjectEvents] = useState<RuntimeLedgerEvent[]>([]);
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

	useEffect(() => {
		if (!workspaceId || outcomes.length === 0) {
			setProjectRuns([]);
			setLoadedProjectEvents([]);
			return;
		}
		let cancelled = false;
		const client = getRuntimeTrpcClient(workspaceId);
		void Promise.all(
			outcomes.map(async (outcome) => {
				const [runResult, eventResult] = await Promise.all([
					client.ledger.listRuns.query({ outcomeId: outcome.id }),
					client.ledger.listEvents.query({ outcomeId: outcome.id }),
				]);
				return { runs: runResult.runs, events: eventResult.events };
			}),
		)
			.then((pages) => {
				if (cancelled) {
					return;
				}
				setProjectRuns(pages.flatMap((page) => page.runs));
				setLoadedProjectEvents(pages.flatMap((page) => page.events));
			})
			.catch(() => {
				if (!cancelled) {
					setProjectRuns([]);
					setLoadedProjectEvents([]);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [workspaceId, outcomes, refreshNonce]);

	const events = useMemo(() => {
		if (!selectedOutcomeId) {
			return [];
		}
		return mergeLedgerEvents(loadedEvents, hubEventsByOutcomeId[selectedOutcomeId] ?? []);
	}, [hubEventsByOutcomeId, loadedEvents, selectedOutcomeId]);

	const projectEvents = useMemo(() => {
		const hubEvents = Object.values(hubEventsByOutcomeId).flat();
		return mergeLedgerEvents(loadedProjectEvents, hubEvents);
	}, [hubEventsByOutcomeId, loadedProjectEvents]);

	return {
		outcomes,
		runs,
		projectRuns,
		events,
		projectEvents,
		isLoadingOutcomes,
		isLoadingTrail,
		refreshOutcomes,
	};
}
