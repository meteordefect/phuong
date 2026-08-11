import type { RuntimeAgentId, RuntimeClineProviderSettings } from "@/runtime/types";
import { isClineProviderAuthenticated } from "@/runtime/native-agent";

export function isSelectedAgentAuthenticated(
	selectedAgentId: RuntimeAgentId | null | undefined,
	clineProviderSettings: RuntimeClineProviderSettings | null | undefined,
): boolean {
	if (selectedAgentId !== "cline") {
		return true;
	}
	return isClineProviderAuthenticated(clineProviderSettings);
}

export function shouldShowStartupOnboardingDialog(_input: {
	hasShownOnboardingDialog: boolean;
	isTaskAgentReady: boolean | null | undefined;
	isSelectedAgentAuthenticated: boolean;
}): boolean {
	// Phuong skips the upstream Cline Kanban "Get started" carousel.
	// Debug tools can still force-open the dialog via handleOpenStartupOnboardingDialog.
	return false;
}
