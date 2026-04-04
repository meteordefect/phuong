import { ClerkProvider, SignIn, useAuth } from "@clerk/react";
import type { ReactElement, ReactNode } from "react";
import { useEffect } from "react";

import { Spinner } from "@/components/ui/spinner";
import { setSessionTokenGetter } from "./session-token-store";

function TokenSync({ children }: { children: ReactNode }): ReactElement {
	const { getToken } = useAuth();

	useEffect(() => {
		setSessionTokenGetter(() => getToken());
		return () => setSessionTokenGetter(null);
	}, [getToken]);

	return <>{children}</>;
}

function RequireAuth({ children }: { children: ReactNode }): ReactElement {
	const { isSignedIn, isLoaded } = useAuth();

	if (!isLoaded) {
		return (
			<div className="flex h-screen items-center justify-center bg-surface-0">
				<Spinner size={28} />
			</div>
		);
	}

	if (!isSignedIn) {
		return (
			<div className="flex h-screen flex-col items-center justify-center gap-4 bg-surface-0">
				<h1 className="text-lg font-semibold text-text-primary">Sign in to continue</h1>
				<SignIn routing="hash" />
			</div>
		);
	}

	return <TokenSync>{children}</TokenSync>;
}

export function ClerkAuthGate({
	publishableKey,
	children,
}: {
	publishableKey: string;
	children: ReactNode;
}): ReactElement {
	return (
		<ClerkProvider publishableKey={publishableKey}>
			<RequireAuth>{children}</RequireAuth>
		</ClerkProvider>
	);
}
