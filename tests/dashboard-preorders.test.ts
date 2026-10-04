import { describe, expect, it } from "vitest";
import {
  summarizePreorders,
  type NotificationDraftRecord,
  type OrderFormRecord,
  type PreorderRecord,
  type PreorderSource,
  type ProductSpecRecord
} from "../src/services/dashboard-preorders.js";
import { centsToMoney } from "../src/services/money.js";
import type { ProductSpec } from "../src/validation/caterer-operations.js";

const catererId = "22000000-0000-4000-8000-000000000001";
const otherCatererId = "22000000-0000-4000-8000-000000000002";
const dumplingSpecId = "8a000000-0000-4000-8000-000000000001";
const soupSpecId = "8a000000-0000-4000-8000-000000000002";
const today = "2030-06-12";
const month = { start: "2030-06-01", end: "2030-06-30" };
const now = new Date("2030-06-12T12:00:00.000Z");

const dumplingSpec: ProductSpec = {
  menuItemId: "33000000-0000-4000-8000-000000000001",
  container: { name: "Dumpling box", capacity: { amount: "12", unit: "each" }, fill: { amount: "12", unit: "each" } },
  recipe: {
    name: "Fictional dumplings",
    yield: { amount: "60", unit: "each" },
    ingredients: [{ name: "Flour", measure: { amount: "500", unit: "g" } }],
    allergens: ["wheat"],
    storageInstructions: "Refrigerate"
  }
};

const specs: ProductSpecRecord[] = [{
  id: dumplingSpecId,
  catererId,
  menuItemId: dumplingSpec.menuItemId,
  productName: "Vegetable Dumplings",
  spec: dumplingSpec,
  createdAt: new Date("2030-05-01T00:00:00.000Z")
}];

const dumplingProduct = {
  productSpecId: dumplingSpecId,
  name: "Vegetable Dumplings",
  unitPrice: "11.50",
  container: "Dumpling box (12 each)",
  maxPackages: 10
};

let sequence = 0;
const nextId = (prefix: string) => {
  sequence += 1;
  return `${prefix}-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
};

function form(overrides: Partial<OrderFormRecord> = {}): OrderFormRecord {
  return {
    id: nextId("8b000000"),
    catererId,
    title: "Weekend dumplings",
    fulfillmentDate: "2030-06-15",
    closesAt: new Date("2030-06-13T22:00:00.000Z"),
    fulfillmentMethod: "PICKUP",
    fulfillmentInstructions: "Pick up at the side door.",
    minimumOrder: "0.00",
    deliveryFee: "0.00",
    products: [dumplingProduct],
    active: true,
    createdAt: new Date("2030-06-01T00:00:00.000Z"),
    updatedAt: new Date("2030-06-01T00:00:00.000Z"),
    ...overrides
  };
}

function preorder(
  formRecord: OrderFormRecord,
  status: PreorderRecord["status"],
  quantity: number,
  overrides: Partial<PreorderRecord> = {}
): PreorderRecord {
  const id = nextId("8c000000");
  return {
    id,
    formId: formRecord.id,
    catererId: formRecord.catererId,
    submissionId: id.replace("8c000000", "8e000000"),
    customerName: `Customer ${sequence}`,
    customerContact: "test:customer:preorder",
    deliveryAddress: "",
    fulfillmentDate: formRecord.fulfillmentDate,
    items: [{ ...dumplingProduct, quantity }],
    total: centsToMoney(quantity * 1_150),
    status,
    createdAt: new Date(`2030-06-0${(sequence % 9) + 1}T00:00:00.000Z`),
    updatedAt: new Date("2030-06-10T00:00:00.000Z"),
    ...overrides
  };
}

function notification(
  order: PreorderRecord,
  status: string,
  updatedAt: string
): NotificationDraftRecord {
  return {
    id: nextId("8d000000"),
    catererId: order.catererId,
    orderId: order.id,
    recipient: order.customerContact,
    body: `Hi ${order.customerName}, your order is scheduled.`,
    status,
    createdAt: new Date(updatedAt),
    updatedAt: new Date(updatedAt)
  };
}

function summarize(overrides: Partial<PreorderSource>) {
  return summarizePreorders(
    catererId,
    { forms: [], preorders: [], notifications: [], productSpecs: specs, now, ...overrides },
    today,
    month
  );
}

describe("preorder dashboard", () => {
  it("classifies forms as open, closed, past, or inactive and lists upcoming ones first", () => {
    const open = form({ title: "Open" });
    const closed = form({ title: "Closed", closesAt: new Date("2030-06-12T11:00:00.000Z") });
    const pastOlder = form({ title: "Past older", fulfillmentDate: "2030-05-01" });
    const pastNewer = form({ title: "Past newer", fulfillmentDate: "2030-06-01" });
    const inactive = form({ title: "Inactive", active: false });
    const later = form({ title: "Later", fulfillmentDate: "2030-06-20" });

    const dashboard = summarize({ forms: [inactive, pastOlder, later, closed, pastNewer, open] });

    expect(dashboard.forms.map((entry) => [entry.title, entry.state])).toEqual([
      ["Closed", "CLOSED"],
      ["Open", "OPEN"],
      ["Later", "OPEN"],
      ["Past newer", "PAST"],
      ["Past older", "PAST"],
      ["Inactive", "INACTIVE"]
    ]);
    expect(dashboard.stats.openForms).toBe(2);
  });

  it("counts reserved packages like submitPreorder, releasing declined and cancelled ones", () => {
    const weekend = form();
    const dashboard = summarize({
      forms: [weekend],
      preorders: [
        preorder(weekend, "REQUESTED", 2),
        preorder(weekend, "ACCEPTED", 3),
        preorder(weekend, "COMPLETED", 1),
        preorder(weekend, "DECLINED", 4),
        preorder(weekend, "CANCELLED", 5)
      ]
    });

    expect(dashboard.forms[0]).toMatchObject({
      preorderCount: 5,
      awaitingReply: 1,
      bookedTotal: { cents: 4_600, amount: "46.00" },
      products: [{ name: "Vegetable Dumplings", maxPackages: 10, reservedPackages: 6 }]
    });
  });

  it("totals booked preorders in the month and upcoming accepted packages", () => {
    const weekend = form();
    const may = form({ fulfillmentDate: "2030-05-20" });
    const dashboard = summarize({
      forms: [weekend, may],
      preorders: [
        preorder(weekend, "ACCEPTED", 2),
        preorder(weekend, "ACCEPTED", 3),
        preorder(weekend, "REQUESTED", 7),
        preorder(may, "COMPLETED", 4)
      ]
    });

    expect(dashboard.stats).toEqual({
      openForms: 1,
      awaitingReply: 1,
      toFulfill: { count: 2, packages: 5, nextDate: "2030-06-15" },
      revenueMonth: { cents: 5_750, amount: "57.50" }
    });
    expect(dashboard.preorders.map((entry) => [entry.fulfillmentDate, entry.status])).toEqual([
      ["2030-06-15", "ACCEPTED"],
      ["2030-06-15", "ACCEPTED"],
      ["2030-06-15", "REQUESTED"],
      ["2030-05-20", "COMPLETED"]
    ]);
    expect(dashboard.preorders[0]?.lines).toEqual([{
      name: "Vegetable Dumplings",
      container: "Dumpling box (12 each)",
      quantity: 2,
      unitPrice: { cents: 1_150, amount: "11.50" },
      lineTotal: { cents: 2_300, amount: "23.00" }
    }]);
  });

  it("plans production per upcoming date from accepted preorders only", () => {
    const weekend = form();
    const dashboard = summarize({
      forms: [weekend],
      preorders: [
        preorder(weekend, "ACCEPTED", 3),
        preorder(weekend, "ACCEPTED", 4),
        preorder(weekend, "REQUESTED", 50),
        preorder(form({ fulfillmentDate: "2030-06-01" }), "ACCEPTED", 9)
      ]
    });

    expect(dashboard.production).toEqual([{
      fulfillmentDate: "2030-06-15",
      orderCount: 2,
      products: [{
        productSpecId: dumplingSpecId,
        productName: "Vegetable Dumplings",
        container: "Dumpling box (12 each)",
        packages: 7,
        batches: 2,
        requiredProduct: { amount: "84", unit: "each" },
        surplus: { amount: "36", unit: "each" }
      }],
      ingredients: [{ name: "Flour", amount: "1000", unit: "g" }],
      problem: null
    }]);
  });

  it("reports a missing recipe instead of failing the dashboard", () => {
    const soupForm = form({ products: [{ ...dumplingProduct, productSpecId: soupSpecId, name: "Soup" }] });
    const order = preorder(soupForm, "ACCEPTED", 2, {
      items: [{ ...dumplingProduct, productSpecId: soupSpecId, name: "Soup", quantity: 2 }]
    });

    const dashboard = summarize({ forms: [soupForm], preorders: [order] });

    expect(dashboard.production[0]).toMatchObject({
      orderCount: 1,
      products: [],
      problem: "Recipe details are missing for Soup."
    });
  });

  it("counts notifications by status and lists the newest with customer names", () => {
    const weekend = form();
    const order = preorder(weekend, "ACCEPTED", 2, { customerName: "Harper Quill" });
    const dashboard = summarize({
      forms: [weekend],
      preorders: [order],
      notifications: [
        notification(order, "SENT", "2030-06-08T10:00:00.000Z"),
        notification(order, "DRAFT", "2030-06-11T10:00:00.000Z"),
        notification(order, "FAILED", "2030-06-09T10:00:00.000Z")
      ]
    });

    expect(dashboard.notifications.counts).toEqual({ DRAFT: 1, SENDING: 0, SENT: 1, FAILED: 1 });
    expect(dashboard.notifications.recent.map((entry) => [entry.status, entry.customerName])).toEqual([
      ["DRAFT", "Harper Quill"],
      ["FAILED", "Harper Quill"],
      ["SENT", "Harper Quill"]
    ]);
  });

  it("ignores forms, preorders, notifications, and recipes of another caterer", () => {
    const theirs = form({ catererId: otherCatererId });
    const order = preorder(theirs, "ACCEPTED", 2);
    const dashboard = summarize({
      forms: [theirs],
      preorders: [order],
      notifications: [notification(order, "DRAFT", "2030-06-11T10:00:00.000Z")],
      productSpecs: specs.map((spec) => ({ ...spec, catererId: otherCatererId }))
    });

    expect(dashboard.forms).toEqual([]);
    expect(dashboard.preorders).toEqual([]);
    expect(dashboard.production).toEqual([]);
    expect(dashboard.notifications.recent).toEqual([]);
    expect(dashboard.stats.toFulfill.count).toBe(0);
  });
});
