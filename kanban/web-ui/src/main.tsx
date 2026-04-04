import type { ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "sonner";

import App from "@/App";
import { ClerkAuthGate } from "@/auth/clerk-auth-gate";
import { AppErrorBoundary } from "@/components/app-error-boundary";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initializeSentry } from "@/telemetry/sentry";
import { TelemetryProvider } from "@/telemetry/posthog-provider";
import "@/styles/globals.css";

initializeSentry();

const root = document.getElementById("root");
if (!root) {
	throw new Error("Root element was not found.");
}

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

function AuthBoundary({ children }: { children: ReactNode }) {
	if (clerkPublishableKey) {
		return <ClerkAuthGate publishableKey={clerkPublishableKey}>{children}</ClerkAuthGate>;
	}
	return <>{children}</>;
}

ReactDOM.createRoot(root).render(
	<TelemetryProvider>
		<AppErrorBoundary>
			<AuthBoundary>
				<TooltipProvider>
					<App />
					<Toaster
						theme="dark"
						position="bottom-right"
						toastOptions={{
							style: {
								background: "var(--color-surface-1)",
								border: "1px solid var(--color-border)",
								color: "var(--color-text-primary)",
								fontSize: "13px",
								whiteSpace: "pre-line"
							},
						}}
					/>
				</TooltipProvider>
			</AuthBoundary>
		</AppErrorBoundary>
	</TelemetryProvider>,
);
