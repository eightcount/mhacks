import { describe, expect, it } from "vitest";
import { summarizeMonthView } from "../src/services/dashboard-month.js";
import type { DashboardPreorder } from "../src/services/dashboard-preorders.js";
import type { DashboardOrderRecord, DashboardSource } from "../src/services/dashboard-summary.js";
import type { Order, OrderStatus } from "../src/types/domain.js";

const catererId = "22000000-0000-4000-8000-000000000001";
const otherCatererId = "22000000-0000-4000-8000-000000000002";
const today = "2030-06-12";
const river = "11000000-0000-4000-8000-000000000006";
const dana = "11000000-0000-4000-8000-000000000007";
const ellis = "11000000-0000-4000-8000-000000000008";
const names: Record<string, string> = { [river]: "River Stone", [dana]: "Dana Cloud", [ellis]: "Ellis Juniper" };

let sequence = 0;

function record(
  status: OrderStatus,
  eventDate: string,
  overrides: Partial<Order> = {}
): DashboardOrderRecord {
  sequence += 1;
  const customerId = overrides.customerId ?? river;
  return {
    order: {
      id: `44000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
      customerId,
      catererId,
      eventDate,
      guestCount: 10,
      budget: "500.00",
      estimatedTotal: "100.00",
      requestedDishes: [],
      requestedCuisines: [],
      eventStyle: "BUFFET",
      dietaryRestrictions: [],
      eventLocation: "Ann Arbor, MI",
      fulfillmentMethod: "PICKUP",
      status,
      specialRequests: null,
      createdAt: new Date("2030-05-20T15:00:00.000Z"),
      updatedAt: new Date("2030-05-21T15:00:00.000Z"),
      ...overrides
    },
    customerName: names[customerId] ?? "Customer",
    items: []
  };
}

function preorder(status: OrderStatus, fulfillmentDate: string, cents: number): DashboardPreorder {
  sequence += 1;
  return {
    id: `8c000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    formId: "8b000000-0000-4000-8000-000000000001",
    formTitle: "Weekend dumplings",
    customerName: "Harper Quill",
    fulfillmentDate,
    deliveryAddress: "",
    status,
    lines: [],
    total: { cents, amount: (cents / 100).toFixed(2) },
    requestedOn: "2030-06-01"
  };
}

function view(orders: DashboardOrderRecord[], month: string, preorders: DashboardPreorder[] = []) {
  const source: DashboardSource = {
    caterer: {
      id: catererId,
      businessName: "Test Kitchen",
      location: "Ann Arbor, MI",
      cuisineTypes: ["CHINESE"],
      maximumCapacity: 85,
      active: true
    },
    ownerName: "Avery Lin",
    orders,
    menu: [],
    availability: [],
    today
  };
  return summarizeMonthView(source, preorders, month);
}

describe("dashboard month view", () => {
  it("scopes revenue to booked orders and preorders dated in the selected month", () => {
    const result = view(
      [
        record("COMPLETED", "2030-05-03", { estimatedTotal: "250.00" }),
        record("ACCEPTED", "2030-05-28", { estimatedTotal: "120.50" }),
        record("REQUESTED", "2030-05-10", { estimatedTotal: "999.00" }),
        record("COMPLETED", "2030-06-02", { estimatedTotal: "999.00" }),
        record("DRAFT", "2030-05-11", { estimatedTotal: "999.00" })
      ],
      "2030-05",
      [preorder("COMPLETED", "2030-05-15", 4_000), preorder("DECLINED", "2030-05-15", 99_900)]
    );

    expect(result.period).toEqual({ start: "2030-05-01", end: "2030-05-31" });
    expect(result.isCurrent).toBe(false);
    expect(result.revenue).toMatchObject({
      total: { cents: 37_050, amount: "370.50" },
      completed: { cents: 25_000 },
      toFill: { cents: 12_050 },
      preorders: { cents: 4_000 },
      preorderCount: 1
    });
    expect(result.revenue.orders.map((order) => order.eventDate)).toEqual(["2030-05-03", "2030-05-28"]);
  });

  it("charts six months ending with the selected month", () => {
    const result = view(
      [
        record("COMPLETED", "2030-01-05", { estimatedTotal: "50.00" }),
        record("COMPLETED", "2030-06-01", { estimatedTotal: "75.00" })
      ],
      "2030-06",
      [preorder("ACCEPTED", "2030-06-20", 1_000)]
    );

    expect(result.trend.map((point) => point.month)).toEqual([
      "2030-01", "2030-02", "2030-03", "2030-04", "2030-05", "2030-06"
    ]);
    expect(result.trend.map((point) => point.total.cents)).toEqual([5_000, 0, 0, 0, 0, 8_500]);
  });

  it("lists orders to fill and filled with guests by day, and the next event from today", () => {
    const result = view(
      [
        record("COMPLETED", "2030-06-03", { guestCount: 12 }),
        record("ACCEPTED", "2030-06-10", { guestCount: 30 }),
        record("ACCEPTED", "2030-06-20", { guestCount: 25 }),
        record("ACCEPTED", "2030-07-01", { guestCount: 99 })
      ],
      "2030-06"
    );

    expect(result.ordersToFill).toMatchObject({ count: 2, guestCount: 55, nextEventDate: "2030-06-20" });
    expect(result.ordersToFill.filled.map((order) => order.eventDate)).toEqual(["2030-06-03"]);
    expect(result.ordersToFill.days).toHaveLength(30);
    expect(result.ordersToFill.days[2]).toEqual({ date: "2030-06-03", toFill: 0, filled: 12 });
    expect(result.ordersToFill.days[9]).toEqual({ date: "2030-06-10", toFill: 30, filled: 0 });
  });

  it("counts requests and preorders awaiting a reply for events in the month", () => {
    const result = view(
      [
        record("REQUESTED", "2030-06-18", { createdAt: new Date("2030-06-09T15:00:00.000Z") }),
        record("REQUESTED", "2030-07-02"),
        record("ACCEPTED", "2030-06-18")
      ],
      "2030-06",
      [preorder("REQUESTED", "2030-06-15", 2_000), preorder("REQUESTED", "2030-07-15", 2_000)]
    );

    expect(result.awaiting.count).toBe(2);
    expect(result.awaiting.requests.map((order) => [order.eventDate, order.requestedOn]))
      .toEqual([["2030-06-18", "2030-06-09"]]);
    expect(result.awaiting.preorders.map((order) => order.fulfillmentDate)).toEqual(["2030-06-15"]);
  });

  it("splits the month's customers into new and returning by their first booked event", () => {
    const result = view(
      [
        record("COMPLETED", "2030-03-01", { customerId: river }),
        record("COMPLETED", "2030-06-02", { customerId: river, estimatedTotal: "300.00" }),
        record("ACCEPTED", "2030-06-25", { customerId: river, estimatedTotal: "200.00" }),
        record("ACCEPTED", "2030-06-22", { customerId: dana, estimatedTotal: "800.00" }),
        record("REQUESTED", "2030-06-20", { customerId: ellis })
      ],
      "2030-06"
    );

    expect(result.customers).toMatchObject({ count: 2, newCount: 1, returningCount: 1 });
    expect(result.customers.customers).toEqual([
      { customerId: dana, name: "Dana Cloud", orderCount: 1, total: { cents: 80_000, amount: "800.00" }, lifetimeOrderCount: 1, isNew: true },
      { customerId: river, name: "River Stone", orderCount: 2, total: { cents: 50_000, amount: "500.00" }, lifetimeOrderCount: 3, isNew: false }
    ]);
    expect(result.trend.at(-1)).toMatchObject({ newCustomers: 1, returningCustomers: 1 });
    expect(result.trend[2]).toMatchObject({ month: "2030-03", newCustomers: 1, returningCustomers: 0 });
  });

  it("offers months from the oldest order through the current month", () => {
    const result = view(
      [record("COMPLETED", "2030-03-15"), record("ACCEPTED", "2030-08-01"), record("COMPLETED", "2027-01-01")],
      "2030-06"
    );

    expect(result.months[0]).toBe("2028-07");
    expect(result.months.at(-1)).toBe("2030-06");
    expect(result.months).toHaveLength(24);
    expect(view([], "2030-06").months).toEqual(["2030-06"]);
    expect(view([], "2030-02").months).toEqual(["2030-02", "2030-06"]);
  });

  it("ignores another caterer's orders", () => {
    const result = view([record("COMPLETED", "2030-06-02", { catererId: otherCatererId })], "2030-06");

    expect(result.revenue.total.cents).toBe(0);
    expect(result.customers.count).toBe(0);
  });
});
