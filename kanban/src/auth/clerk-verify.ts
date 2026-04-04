import type { IncomingMessage } from "node:http";
import { verifyToken } from "@clerk/backend";

const clerkSecretKey = process.env.CLERK_SECRET_KEY ?? "";
const authEnabled = clerkSecretKey.length > 0;

export function isAuthEnabled(): boolean {
	return authEnabled;
}

function extractBearerToken(req: IncomingMessage): string | null {
	const header = req.headers.authorization;
	if (typeof header === "string" && header.startsWith("Bearer ")) {
		return header.slice(7);
	}
	return null;
}

function extractQueryToken(url: URL): string | null {
	return url.searchParams.get("token") ?? null;
}

export async function verifyHttpRequest(req: IncomingMessage): Promise<{ userId: string } | null> {
	if (!authEnabled) {
		return { userId: "local" };
	}
	const token = extractBearerToken(req);
	if (!token) {
		return null;
	}
	return await verifyClerkToken(token);
}

export async function verifyWebSocketUpgrade(req: IncomingMessage, url: URL): Promise<{ userId: string } | null> {
	if (!authEnabled) {
		return { userId: "local" };
	}
	const token = extractQueryToken(url) ?? extractBearerToken(req);
	if (!token) {
		return null;
	}
	return await verifyClerkToken(token);
}

async function verifyClerkToken(token: string): Promise<{ userId: string } | null> {
	try {
		const result = await verifyToken(token, { secretKey: clerkSecretKey });
		if ("sub" in result && typeof result.sub === "string") {
			return { userId: result.sub };
		}
		return null;
	} catch {
		return null;
	}
}
