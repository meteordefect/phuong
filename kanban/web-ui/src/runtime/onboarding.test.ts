import { describe, expect, it } from "vitest";

import {
	isSelectedAgentAuthenticated,
	shouldShowStartupOnboardingDialog,
} from "@/runtime/onboarding";

describe("runtime onboarding helpers", () => {
	it("treats non-cline selections as authenticated", () => {
		expect(isSelectedAgentAuthenticated("claude", null)).toBe(true);
		expect(isSelectedAgentAuthenticated("codex", null)).toBe(true);
	});

	it("checks cline authentication from provider settings", () => {
		expect(
			isSelectedAgentAuthenticated("cline", {
				providerId: null,
				modelId: null,
				baseUrl: null,
				apiKeyConfigured: false,
				oauthProvider: null,
				oauthAccessTokenConfigured: false,
				oauthRefreshTokenConfigured: false,
				oauthAccountId: null,
				oauthExpiresAt: null,
			}),
		).toBe(false);
		expect(
			isSelectedAgentAuthenticated("cline", {
				providerId: "anthropic",
				modelId: "claude-3-7-sonnet",
				baseUrl: null,
				apiKeyConfigured: true,
				oauthProvider: null,
				oauthAccessTokenConfigured: false,
				oauthRefreshTokenConfigured: false,
				oauthAccountId: null,
				oauthExpiresAt: null,
			}),
		).toBe(true);
	});

	it("never auto-opens the Cline Kanban startup onboarding dialog", () => {
		expect(
			shouldShowStartupOnboardingDialog({
				hasShownOnboardingDialog: false,
				isTaskAgentReady: false,
				isSelectedAgentAuthenticated: false,
			}),
		).toBe(false);
		expect(
			shouldShowStartupOnboardingDialog({
				hasShownOnboardingDialog: true,
				isTaskAgentReady: true,
				isSelectedAgentAuthenticated: true,
			}),
		).toBe(false);
	});
});
