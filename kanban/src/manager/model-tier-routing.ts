import type { RuntimeTaskTier } from "../core/api-contract.js";

/**
 * Maps Hermes capability tiers to Pi model IDs.
 * Override via env on the VPS without code changes.
 */
export function resolveModelForTier(tier: RuntimeTaskTier | string | undefined): string | undefined {
	const normalized = (tier ?? "").trim().toUpperCase();
	const light =
		process.env.PHUONG_MODEL_T0?.trim() ||
		process.env.SUBAGENT_MODEL_LIGHT?.trim() ||
		"kimi-coding/kimi-k2.7";
	const standard =
		process.env.PHUONG_MODEL_T1?.trim() ||
		process.env.SUBAGENT_MODEL?.trim() ||
		process.env.DEFAULT_MODEL?.trim() ||
		light;
	const complex =
		process.env.PHUONG_MODEL_T2?.trim() ||
		process.env.PHUONG_MODEL_T3?.trim() ||
		process.env.SUBAGENT_MODEL_COMPLEX?.trim() ||
		"kimi-coding/kimi-k3";

	switch (normalized) {
		case "T0":
			return light;
		case "T1":
			return standard;
		case "T2":
		case "T3":
			return complex;
		default:
			return undefined;
	}
}

export function resolveChatModel(input: {
	model?: string;
	tier?: RuntimeTaskTier | string;
}): string | undefined {
	const explicit = input.model?.trim();
	if (explicit) {
		return explicit;
	}
	return resolveModelForTier(input.tier);
}
