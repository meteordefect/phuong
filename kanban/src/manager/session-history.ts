import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	parseSessionEntries,
	type FileEntry,
	type SessionHeader,
	type SessionMessageEntry,
	type SessionInfoEntry,
} from "@mariozechner/pi-coding-agent";
import { isMemoryConfigured, getMemoryDir } from "../memory/memory-service.js";
import { scrubCredentials } from "./credential-scrubber.js";

export interface SessionListItem {
	id: string;
	path: string;
	name?: string;
	created: string;
	modified: string;
	messageCount: number;
	preview: string;
}

export interface SessionMessage {
	role: "user" | "assistant";
	content: string;
}

export interface LoadedSession {
	id: string;
	name?: string;
	created: string;
	messages: SessionMessage[];
}

function getSessionDir(): string {
	if (isMemoryConfigured()) {
		return join(getMemoryDir(), "sessions");
	}
	return join(process.env.HOME || "/tmp", ".phuong-sessions");
}

function isSessionHeader(entry: FileEntry): entry is SessionHeader {
	return entry.type === "session";
}

function isMessageEntry(entry: FileEntry): entry is SessionMessageEntry {
	return entry.type === "message";
}

function isSessionInfoEntry(entry: FileEntry): entry is SessionInfoEntry {
	return entry.type === "session_info";
}

function extractTextContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((b: { type?: string }) => b.type === "text")
			.map((b: { text?: string }) => b.text || "")
			.join("\n");
	}
	return "";
}

export async function listSessions(): Promise<SessionListItem[]> {
	const dir = getSessionDir();
	if (!existsSync(dir)) return [];

	const files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
	const sessions: SessionListItem[] = [];

	const results = await Promise.all(
		files.map(async (file) => {
			const filePath = join(dir, file);
			try {
				const content = await readFile(filePath, "utf8");
				const entries = parseSessionEntries(content);
				if (entries.length === 0) return null;

				const header = entries[0]!;
				if (!isSessionHeader(header)) return null;

				const stats = await stat(filePath);
				let messageCount = 0;
				let firstMessage = "";
				let name: string | undefined;

				for (const entry of entries) {
					if (isSessionInfoEntry(entry)) {
						name = entry.name?.trim() || undefined;
					}
					if (!isMessageEntry(entry)) continue;
					messageCount++;
					const msg = entry.message;
					if (!firstMessage && "role" in msg && msg.role === "user" && "content" in msg) {
						firstMessage = scrubCredentials(extractTextContent(msg.content));
					}
				}

				return {
					id: header.id,
					path: filePath,
					name,
					created: header.timestamp || stats.birthtime.toISOString(),
					modified: stats.mtime.toISOString(),
					messageCount,
					preview: firstMessage ? firstMessage.slice(0, 200) : "(no messages)",
				};
			} catch {
				return null;
			}
		}),
	);

	for (const r of results) {
		if (r) sessions.push(r);
	}

	sessions.sort(
		(a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime(),
	);
	return sessions;
}

export async function loadSession(sessionId: string): Promise<LoadedSession | null> {
	const dir = getSessionDir();
	if (!existsSync(dir)) return null;

	const files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));

	for (const file of files) {
		const filePath = join(dir, file);
		try {
			const content = await readFile(filePath, "utf8");
			const entries = parseSessionEntries(content);
			if (entries.length === 0) continue;

			const header = entries[0]!;
			if (!isSessionHeader(header) || header.id !== sessionId) continue;

			const messages: SessionMessage[] = [];
			let name: string | undefined;

			for (const entry of entries) {
				if (isSessionInfoEntry(entry)) {
					name = entry.name?.trim() || undefined;
				}
				if (!isMessageEntry(entry)) continue;
				const msg = entry.message;
				if (!("role" in msg) || (msg.role !== "user" && msg.role !== "assistant")) continue;
				if (!("content" in msg)) continue;

				const textContent = scrubCredentials(extractTextContent(msg.content));
				if (!textContent.trim()) continue;

				messages.push({ role: msg.role, content: textContent });
			}

			return {
				id: sessionId,
				name,
				created: header.timestamp || "",
				messages,
			};
		} catch {
			continue;
		}
	}

	return null;
}

export async function findSessionFilePath(sessionId: string): Promise<string | null> {
	const dir = getSessionDir();
	if (!existsSync(dir)) return null;

	const files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
	for (const file of files) {
		const filePath = join(dir, file);
		try {
			const content = await readFile(filePath, "utf8");
			const firstLine = content.split("\n")[0];
			if (!firstLine) continue;
			const parsed = JSON.parse(firstLine) as { type?: string; id?: string };
			if (parsed.type === "session" && parsed.id === sessionId) {
				return filePath;
			}
		} catch {
			continue;
		}
	}
	return null;
}
