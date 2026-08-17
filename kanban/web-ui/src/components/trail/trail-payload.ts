export function payloadString(payload: Record<string, unknown>, key: string): string | null {
	const value = payload[key];
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export function payloadNumber(payload: Record<string, unknown>, key: string): number | null {
	const value = payload[key];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function payloadBoolean(payload: Record<string, unknown>, key: string): boolean | null {
	const value = payload[key];
	return typeof value === "boolean" ? value : null;
}

export function payloadOneLiner(value: unknown, max = 120): string | null {
	if (value == null) {
		return null;
	}
	if (typeof value === "string") {
		const trimmed = value.replace(/\s+/g, " ").trim();
		if (!trimmed) {
			return null;
		}
		return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
	}
	try {
		const json = JSON.stringify(value);
		if (!json || json === "{}" || json === "[]") {
			return null;
		}
		return json.length > max ? `${json.slice(0, max)}…` : json;
	} catch {
		return null;
	}
}

export function formatTrailTime(createdAt: number): string {
	if (!Number.isFinite(createdAt) || createdAt <= 0) {
		return "";
	}
	try {
		return new Date(createdAt).toLocaleTimeString(undefined, {
			hour: "2-digit",
			minute: "2-digit",
		});
	} catch {
		return "";
	}
}
