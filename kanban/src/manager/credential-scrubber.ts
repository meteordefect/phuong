import { readFile, writeFile } from "node:fs/promises";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const SENSITIVE_ENV_SUFFIXES =
	/(API_KEY|_KEY|_SECRET|SECRET_KEY|_TOKEN|_PASSWORD|_PASS|_PASSPHRASE|_PRIVATE_KEY|_CREDENTIAL|_CREDENTIALS|DATABASE_URL|_DSN)$/;

const ENV_LINE_PATTERN = /^([A-Z][A-Z0-9_]*)=(.+)/gm;

const CREDENTIAL_PATTERNS: readonly RegExp[] = [
	/ghp_[A-Za-z0-9_]{36,}/g,
	/github_pat_[A-Za-z0-9_]{22,}/g,
	/sk-ant-[A-Za-z0-9_-]{20,}/g,
	/sk-[A-Za-z0-9_-]{20,}/g,
	/sk_live_[A-Za-z0-9]{20,}/g,
	/pk_live_[A-Za-z0-9]{20,}/g,
	/sk_test_[A-Za-z0-9]{20,}/g,
	/pk_test_[A-Za-z0-9]{20,}/g,
	/gsk_[A-Za-z0-9]{20,}/g,
	/xai-[A-Za-z0-9]{20,}/g,
];

const REDACTED = "[REDACTED]";

export function scrubCredentials(text: string): string {
	let result = text.replace(ENV_LINE_PATTERN, (_match, key: string, value: string) => {
		if (SENSITIVE_ENV_SUFFIXES.test(key) && value.trim()) {
			return `${key}=${REDACTED}`;
		}
		return _match;
	});

	for (const pattern of CREDENTIAL_PATTERNS) {
		pattern.lastIndex = 0;
		result = result.replace(pattern, REDACTED);
	}

	return result;
}

export function scrubJsonValue(value: unknown): unknown {
	if (typeof value === "string") return scrubCredentials(value);
	if (Array.isArray(value)) return value.map(scrubJsonValue);
	if (value !== null && typeof value === "object") {
		const obj = value as Record<string, unknown>;
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(obj)) {
			out[k] = scrubJsonValue(v);
		}
		return out;
	}
	return value;
}

export async function scrubSessionFile(filePath: string): Promise<boolean> {
	const content = await readFile(filePath, "utf8");
	const scrubbed = scrubJsonlContent(content);
	if (scrubbed !== null) {
		await writeFile(filePath, scrubbed, "utf8");
		return true;
	}
	return false;
}

function scrubJsonlContent(content: string): string | null {
	const lines = content.split("\n");
	let modified = false;

	const scrubbedLines = lines.map((line) => {
		if (!line.trim()) return line;
		try {
			const parsed = JSON.parse(line);
			const scrubbed = scrubJsonValue(parsed);
			const scrubbedStr = JSON.stringify(scrubbed);
			const normalizedStr = JSON.stringify(parsed);
			if (scrubbedStr !== normalizedStr) {
				modified = true;
				return scrubbedStr;
			}
			return line;
		} catch {
			return line;
		}
	});

	return modified ? scrubbedLines.join("\n") : null;
}

export function scrubAllSessionFilesSync(sessionsDir: string): number {
	if (!existsSync(sessionsDir)) return 0;

	const files = readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
	let count = 0;

	for (const file of files) {
		const filePath = join(sessionsDir, file);
		const content = readFileSync(filePath, "utf8");
		const scrubbed = scrubJsonlContent(content);
		if (scrubbed !== null) {
			writeFileSync(filePath, scrubbed, "utf8");
			count++;
		}
	}

	return count;
}
