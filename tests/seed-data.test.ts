import { describe, expect, it } from "vitest";
import { buildDashboardOrderPlans, dashboardCustomers, demoCatererIds, offsetSeedDate } from "../src/db/seed-data.js";
import { orderStatuses } from "../src/types/domain.js";

describe("fictional dashboard fixtures", () => {
  it("covers every status for every active caterer with stable unique order IDs", () => {
    const plans = buildDashboardOrderPlans("2026-10-03");
    expect(plans).toHaveLength(24);
    expect(new Set(plans.map((plan) => plan.id)).size).toBe(24);
    expect(buildDashboardOrderPlans("2026-11-01").map((plan) => plan.id))
      .toEqual(plans.map((plan) => plan.id));
    for (const catererId of demoCatererIds) {
      expect(plans.filter((plan) => plan.catererId === catererId).map((plan) => plan.status).sort())
        .toEqual([...orderStatuses].sort());
    }
  });

  it("gives completed orders a past event date and a consistent creation date", () => {
    const referenceDate = "2026-10-03";
    for (const plan of buildDashboardOrderPlans(referenceDate)) {
      const createdDate = plan.createdAt.toISOString().slice(0, 10);
      expect(createdDate <= plan.eventDate).toBe(true);
      expect(plan.status === "COMPLETED" ? plan.eventDate < referenceDate : plan.eventDate > referenceDate)
        .toBe(true);
    }
  });

  it("provides fictional messaging identifiers and orders for every new customer", () => {
    const plans = buildDashboardOrderPlans("2026-10-03");
    for (const customer of dashboardCustomers) {
      expect(customer.messagingIdentifier).toMatch(/^test:customer:dashboard-\d+$/);
      expect(plans.some((plan) => plan.customerId === customer.id)).toBe(true);
    }
  });

  it("calculates date boundaries in UTC", () => {
    expect(offsetSeedDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(offsetSeedDate("2028-03-01", -1)).toBe("2028-02-29");
  });
});
