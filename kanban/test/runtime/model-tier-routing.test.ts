import { describe, expect, it } from "vitest";
import { resolveChatModel, resolveModelForTier } from "../../src/manager/model-tier-routing.js";

describe("model tier routing", () => {
	it("maps T0 to light model and T2/T3 to complex", () => {
		expect(resolveModelForTier("T0")).toBe("kimi-coding/kimi-k2.7");
		expect(resolveModelForTier("T2")).toBe("kimi-coding/kimi-k3");
		expect(resolveModelForTier("T3")).toBe("kimi-coding/kimi-k3");
	});

	it("prefers explicit model over tier", () => {
		expect(resolveChatModel({ model: "kimi-coding/kimi-k3", tier: "T0" })).toBe("kimi-coding/kimi-k3");
		expect(resolveChatModel({ tier: "T0" })).toBe("kimi-coding/kimi-k2.7");
	});
});
