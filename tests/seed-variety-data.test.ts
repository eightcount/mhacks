import { describe, expect, it } from "vitest";
import {
  buildVarietyOperations,
  buildVarietyOrderPlans,
  catererVarieties,
  orderTimeline,
  preorderCustomers,
  varietyCustomers,
  varietyMenuItems,
  varietyProductSpecs
} from "../src/db/seed-variety-data.js";
import { validateProductSpec } from "../src/services/production-math.js";
import { dietaryTags, eventStyles } from "../src/types/domain.js";

const referenceDate = "2026-10-04";

describe("fictional variety orders", () => {
  const plans = buildVarietyOrderPlans(referenceDate);

  it("uses stable, unique IDs that don't overlap the original dashboard fixtures", () => {
    expect(new Set(plans.map((plan) => plan.id)).size).toBe(plans.length);
    expect(buildVarietyOrderPlans("2027-01-15").map((plan) => plan.id))
      .toEqual(plans.map((plan) => plan.id));
    for (const plan of plans) {
      expect(Number(plan.id.slice(-12))).toBeGreaterThan(100);
    }
  });

  it("puts completed orders in the past and open orders in the future", () => {
    for (const plan of plans) {
      if (plan.status === "COMPLETED") expect(plan.eventDate < referenceDate).toBe(true);
      if (["REQUESTED", "ACCEPTED", "DRAFT"].includes(plan.status)) {
        expect(plan.eventDate > referenceDate).toBe(true);
      }
    }
  });

  it("covers six months of history and every submitted status for each caterer", () => {
    for (const { catererId } of catererVarieties) {
      const own = plans.filter((plan) => plan.catererId === catererId);
      for (const status of ["REQUESTED", "ACCEPTED", "COMPLETED", "DECLINED"] as const) {
        expect(own.some((plan) => plan.status === status)).toBe(true);
      }
      const earliest = own.map((plan) => plan.eventDate).sort()[0]!;
      // The dashboard trend starts five months before the current month.
      expect(earliest <= "2026-05-01").toBe(true);
      expect(new Set(own.map((plan) => plan.eventDate)).size).toBe(own.length);
    }
  });

  it("varies guests, styles, dietary needs, customers, and fulfillment within each caterer's limits", () => {
    for (const variety of catererVarieties) {
      const own = plans.filter((plan) => plan.catererId === variety.catererId);
      expect(new Set(own.map((plan) => plan.guestCount)).size).toBeGreaterThan(own.length / 2);
      expect(new Set(own.map((plan) => plan.customerId)).size).toBeGreaterThan(5);
      expect(own.some((plan) => plan.dietaryRestrictions.length > 0)).toBe(true);
      for (const plan of own) {
        expect(plan.guestCount).toBeGreaterThanOrEqual(variety.guests[0]);
        expect(plan.guestCount).toBeLessThanOrEqual(variety.guests[1]);
        expect(variety.styles).toContain(plan.eventStyle);
        expect(variety.fulfillment).toContain(plan.fulfillmentMethod);
        expect(plan.lines.length).toBeGreaterThan(0);
        expect(plan.lines[0]!.quantity).toBe(plan.guestCount);
      }
    }
    expect(new Set(plans.map((plan) => plan.eventStyle)).size).toBe(eventStyles.length - 1);
    expect(new Set(plans.map((plan) => plan.fulfillmentMethod))).toEqual(new Set(["PICKUP", "DELIVERY"]));
  });

  it("only orders items that meet the order's dietary restrictions, and inactive items only historically", () => {
    const tags = new Map(catererVarieties.flatMap((variety) =>
      [...variety.mains, ...variety.sides, ...variety.desserts].map((choice) => [choice.id, choice] as const)
    ));
    for (const plan of plans) {
      for (const line of plan.lines) {
        const choice = tags.get(line.menuItemId)!;
        expect(plan.dietaryRestrictions.every((tag) => choice.tags.includes(tag))).toBe(true);
        if (!choice.active) expect(plan.status).toBe("COMPLETED");
      }
    }
  });

  it("dates every request before the reference date and before its event", () => {
    for (const plan of plans) {
      const { createdAt, updatedAt } = orderTimeline(plan.eventDate, plan.status, referenceDate, plan.leadDays);
      expect(createdAt.toISOString().slice(0, 10) < referenceDate).toBe(true);
      expect(createdAt.toISOString().slice(0, 10) <= plan.eventDate).toBe(true);
      expect(updatedAt.getTime()).toBeGreaterThanOrEqual(createdAt.getTime());
      if (plan.status === "COMPLETED") {
        expect(updatedAt.toISOString().slice(0, 10)).toBe(plan.eventDate);
      }
    }
  });
});

describe("fictional variety catalog", () => {
  it("adds fictional customers and menu items with valid dietary tags", () => {
    for (const customer of varietyCustomers) {
      expect(customer.messagingIdentifier).toMatch(/^test:customer:variety-\d+$/);
    }
    for (const customer of preorderCustomers) {
      expect(customer.contact).toMatch(/^test:customer:preorder-\d+$/);
    }
    for (const item of varietyMenuItems) {
      expect(item.dietaryTags.every((tag) => (dietaryTags as readonly string[]).includes(tag))).toBe(true);
      expect(item.price).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it("defines valid recipe and container specs for active items of the same caterer", () => {
    const active = new Map([
      ...catererVarieties.flatMap((variety) =>
        [...variety.mains, ...variety.sides, ...variety.desserts].map((choice) => [choice.id, { ...choice, catererId: variety.catererId }] as const)
      )
    ]);
    for (const entry of varietyProductSpecs) {
      expect(() => validateProductSpec(entry.spec)).not.toThrow();
      const choice = active.get(entry.spec.menuItemId)!;
      expect(choice.catererId).toBe(entry.catererId);
      expect(choice.active).toBe(true);
    }
  });
});

describe("fictional variety order forms", () => {
  const { forms, preorders, notifications } = buildVarietyOperations(referenceDate);

  it("keeps every form's reserved packages within its limits", () => {
    for (const form of forms) {
      for (const product of form.products) {
        const reserved = preorders
          .filter((order) => order.formId === form.id && !["DECLINED", "CANCELLED"].includes(order.status))
          .flatMap((order) => order.items)
          .filter((item) => item.productSpecId === product.productSpecId)
          .reduce((total, item) => total + item.quantity, 0);
        expect(reserved).toBeLessThanOrEqual(product.maxPackages);
      }
    }
  });

  it("submits preorders while forms are open and completes only past ones", () => {
    for (const order of preorders) {
      const form = forms.find((entry) => entry.id === order.formId)!;
      expect(order.catererId).toBe(form.catererId);
      expect(order.createdAt.getTime()).toBeLessThan(form.closesAt.getTime());
      expect(order.createdAt.toISOString().slice(0, 10) < referenceDate).toBe(true);
      if (order.status === "COMPLETED") expect(form.fulfillmentDate < referenceDate).toBe(true);
      if (form.fulfillmentMethod === "DELIVERY") expect(order.deliveryAddress).not.toBe("");
      expect(order.items.every((item) => item.quantity > 0)).toBe(true);
    }
  });

  it("includes open, closed, past, and inactive forms", () => {
    const now = new Date(`${referenceDate}T12:00:00.000Z`);
    const states = new Set(forms.map((form) =>
      !form.active ? "INACTIVE"
        : form.fulfillmentDate < referenceDate ? "PAST"
          : form.closesAt > now ? "OPEN" : "CLOSED"
    ));
    expect(states).toEqual(new Set(["OPEN", "CLOSED", "PAST", "INACTIVE"]));
  });

  it("drafts notifications only for accepted or completed preorders, in every delivery state", () => {
    for (const notification of notifications) {
      const order = preorders.find((entry) => entry.id === notification.orderId)!;
      expect(["ACCEPTED", "COMPLETED"]).toContain(order.status);
      expect(notification.catererId).toBe(order.catererId);
    }
    expect(new Set(notifications.map((notification) => notification.status)))
      .toEqual(new Set(["DRAFT", "SENT", "FAILED"]));
  });
});
