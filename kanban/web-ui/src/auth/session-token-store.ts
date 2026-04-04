type TokenGetter = () => Promise<string | null>;

let activeTokenGetter: TokenGetter | null = null;
let cachedToken: string | null = null;

export function setSessionTokenGetter(getter: TokenGetter | null): void {
	activeTokenGetter = getter;
	if (!getter) {
		cachedToken = null;
	}
}

export async function getSessionToken(): Promise<string | null> {
	if (!activeTokenGetter) {
		return null;
	}
	cachedToken = await activeTokenGetter();
	return cachedToken;
}

export function getSessionTokenSync(): string | null {
	return cachedToken;
}
