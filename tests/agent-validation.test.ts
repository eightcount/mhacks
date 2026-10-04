import { describe, expect, it } from "vitest";
import {
  createAgentSessionSchema,
  requestStatePatchSchema,
  updateRequestStateRequestSchema
} from "../src/validation/index.js";

const customerId = "11000000-0000-4000-8000-000000000006";
const conversationId = "66000000-0000-4000-8000-000000000010";

describe("agent request-state validation", () => {
  it("accepts an incomplete request state without manufacturing unknown values", () => {
    const patch = requestStatePatchSchema.parse({
      cuisines: ["Chinese"],
      headcount: 30
    });

    expect(patch).toEqual({ cuisines: ["Chinese"], headcount: 30 });
    expect("budget" in patch).toBe(false);
    expect("fulfillmentMethod" in patch).toBe(false);
    expect("dietaryRestrictionsConfirmed" in patch).toBe(false);
  });

  it("requires a valid session identity and rejects invalid state values", () => {
    expect(
      createAgentSessionSchema.safeParse({
        externalConversationId: "local-demo",
        customerId
      }).success
    ).toBe(true);
    expect(createAgentSessionSchema.safeParse({ externalConversationId: "", customerId }).success).toBe(
      false
    );
    expect(requestStatePatchSchema.safeParse({ budget: -1 }).success).toBe(false);
    expect(requestStatePatchSchema.safeParse({ headcount: 0 }).success).toBe(false);
    expect(requestStatePatchSchema.safeParse({ eventStyle: "IMPROVISED" }).success).toBe(false);
    expect(
      requestStatePatchSchema.safeParse({ dietaryRestrictionsConfirmed: true }).success
    ).toBe(true);
  });

  it("validates the state address before a persisted update", () => {
    expect(
      updateRequestStateRequestSchema.safeParse({
        conversationId,
        customerId,
        patch: { fulfillmentMethod: "DELIVERY" }
      }).success
    ).toBe(true);
    expect(
      updateRequestStateRequestSchema.safeParse({
        conversationId: "not-a-uuid",
        customerId,
        patch: { cuisines: ["Chinese"] }
      }).success
    ).toBe(false);
  });

  it("preserves exact decimal budgets and explicit clearing in request state", () => {
    expect(requestStatePatchSchema.parse({ budget: "0.29" }).budget).toBe("0.29");
    expect(requestStatePatchSchema.parse({ budget: "9999999999.99" }).budget).toBe("9999999999.99");
    expect(requestStatePatchSchema.parse({ budget: null }).budget).toBeNull();
  });
});
