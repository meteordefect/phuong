export interface AgentModelLike {
	id: string;
	provider: string;
	name?: string;
}

export function normalizeModelKey(model: Pick<AgentModelLike, "provider" | "id">): string {
	return `${model.provider}/${model.id}`.toLowerCase();
}

export function resolveModelByInput<TModel extends AgentModelLike>(
	available: TModel[],
	value: string,
): TModel | null {
	const normalized = value.trim().toLowerCase();
	if (!normalized) {
		return null;
	}

	const exactComposite = available.find((model) => normalizeModelKey(model) === normalized);
	if (exactComposite) {
		return exactComposite;
	}

	const exactId = available.find((model) => model.id.toLowerCase() === normalized);
	if (exactId) {
		return exactId;
	}

	return (
		available.find(
			(model) =>
				model.id.toLowerCase().includes(normalized) || normalizeModelKey(model).includes(normalized),
		) ?? null
	);
}

const HIGH_PRIORITY_MODEL_PATTERNS = [
	/claude[-_]?opus/i,
	/claude[-_]?sonnet[-_]?4/i,
	/gpt[-_]?5/i,
	/\bo3\b/i,
	/gemini[-_]?2\.5[-_]?pro/i,
	/deepseek[-_]?r1/i,
];

const LOW_PRIORITY_MODEL_PATTERNS = [
	/haiku/i,
	/mini/i,
	/nano/i,
	/flash[-_]?lite/i,
	/\blite\b/i,
	/small/i,
];

function scoreModelQuality(model: AgentModelLike): number {
	const key = `${model.provider}/${model.id}/${model.name ?? ""}`;
	let score = 0;

	for (const pattern of HIGH_PRIORITY_MODEL_PATTERNS) {
		if (pattern.test(key)) {
			score += 50;
		}
	}

	for (const pattern of LOW_PRIORITY_MODEL_PATTERNS) {
		if (pattern.test(key)) {
			score -= 25;
		}
	}

	return score;
}

export function selectPreferredPhoungModel<TModel extends AgentModelLike>(
	availableModels: TModel[],
	defaultModelEnvValue: string,
): TModel | null {
	if (availableModels.length === 0) {
		return null;
	}

	const fromEnv = resolveModelByInput(availableModels, defaultModelEnvValue);
	if (fromEnv) {
		return fromEnv;
	}

	const ranked = [...availableModels].sort((left, right) => {
		const scoreDiff = scoreModelQuality(right) - scoreModelQuality(left);
		if (scoreDiff !== 0) {
			return scoreDiff;
		}
		return normalizeModelKey(left).localeCompare(normalizeModelKey(right));
	});
	return ranked[0] ?? null;
}
