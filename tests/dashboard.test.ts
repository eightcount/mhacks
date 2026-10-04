import { describe, expect, it } from "vitest";
import type { Order, OrderStatus } from "../src/types/domain.js";
import {
  availabilityPeriod,
  monthContaining,
  summarizeCatererDashboard,
  type DashboardOrderRecord,
  type DashboardSource
} from "../src/services/dashboard-summary.js";
import { getCatererDashboardSchema } from "../src/validation/index.js";

const catererId = "22000000-0000-4000-8000-000000000001";
const otherCatererId = "22000000-0000-4000-8000-000000000002";
const dumplingsId = "33000000-0000-4000-8000-000000000001";
const friedRiceId = "33000000-0000-4000-8000-000000000002";
const retiredItemId = "33000000-0000-4000-8000-000000000003";
const chickenId = "33000000-0000-4000-8000-000000000004";

const menu = [
  {
    id: dumplingsId,
    catererId,
    name: "Vegetable Dumplings",
    description: "Hand-folded dumplings.",
    price: "11.50",
    dietaryTags: ["VEGETARIAN", "VEGAN"],
    active: true
  },
  {
    id: friedRiceId,
    catererId,
    name: "Ginger Scallion Fried Rice",
    description: "Wok-tossed rice.",
    price: "10.00",
    dietaryTags: ["VEGETARIAN", "VEGAN", "GLUTEN_FREE"],
    active: true
  },
  {
    id: retiredItemId,
    catererId,
    name: "Retired Special",
    description: "No longer offered.",
    price: "9.00",
    dietaryTags: [],
    active: false
  },
  {
    id: chickenId,
    catererId,
    name: "Five-Spice Chicken",
    description: "Roasted chicken.",
    price: "13.50",
    dietaryTags: [],
    active: true
  }
];
const menuNames = Object.fromEntries(menu.map((item) => [item.id, item.name]));
const menuPrices = Object.fromEntries(menu.map((item) => [item.id, item.price]));

let orderSequence = 0;

function record(
  overrides: Partial<Order> & { status: OrderStatus; eventDate: string },
  lines: Array<[string, number, string?]> = [[dumplingsId, 10]]
): DashboardOrderRecord {
  orderSequence += 1;
  const id = `44000000-0000-4000-8000-${String(orderSequence).padStart(12, "0")}`;
  return {
    order: {
      id,
      customerId: "11000000-0000-4000-8000-000000000006",
      catererId,
      guestCount: 10,
      budget: "500.00",
      estimatedTotal: "115.00",
      requestedDishes: [],
      requestedCuisines: [],
      eventStyle: "BUFFET",
      dietaryRestrictions: [],
      eventLocation: "Ann Arbor, MI",
      fulfillmentMethod: "PICKUP",
      specialRequests: null,
      createdAt: new Date(Date.UTC(2030, 5, 1, 0, 0, orderSequence)),
      updatedAt: new Date(Date.UTC(2030, 5, 1)),
      ...overrides
    },
    customerName: "River Stone",
    items: lines.map(([menuItemId, quantity, unitPrice], index) => ({
      item: {
        id: `55000000-0000-4000-8000-${String(orderSequence * 10 + index).padStart(12, "0")}`,
        orderId: id,
        menuItemId,
        quantity,
        unitPrice: unitPrice ?? menuPrices[menuItemId] ?? "0.00",
        createdAt: new Date(Date.UTC(2030, 5, 1))
      },
      menuItem: { name: menuNames[menuItemId] ?? "Unknown item" }
    }))
  };
}

function summarize(
  orders: DashboardOrderRecord[],
  overrides: Partial<Omit<DashboardSource, "orders">> = {}
) {
  return summarizeCatererDashboard({
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
    menu,
    availability: [],
    today: "2030-06-12",
    ...overrides
  });
}

describe("dashboard periods", () => {
  it("handles months that cross boundaries", () => {
    expect(monthContaining("2028-02-10")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(monthContaining("2030-06-30")).toEqual({ start: "2030-06-01", end: "2030-06-30" });
  });

  it("shows fourteen days of availability starting today", () => {
    expect(availabilityPeriod("2030-06-12")).toEqual({ start: "2030-06-12", end: "2030-06-25" });
    expect(availabilityPeriod("2030-12-25")).toEqual({ start: "2030-12-25", end: "2031-01-07" });
  });

  it("rejects dates that do not exist", () => {
    expect(() => availabilityPeriod("2030-02-30")).toThrow();
    expect(getCatererDashboardSchema.safeParse({
      catererId,
      actorUserId: "11000000-0000-4000-8000-000000000001",
      today: "2030-02-30"
    }).success).toBe(false);
  });
});

describe("caterer dashboard summary", () => {
  it("counts only booked orders this month toward revenue", () => {
    const dashboard = summarize([
      record({ status: "ACCEPTED", eventDate: "2030-06-14", estimatedTotal: "370.00" }),
      record({ status: "COMPLETED", eventDate: "2030-06-03", estimatedTotal: "120.10" }),
      record({ status: "COMPLETED", eventDate: "2030-05-31", estimatedTotal: "999.00" }),
      record({ status: "REQUESTED", eventDate: "2030-06-20", estimatedTotal: "500.00" }),
      record({ status: "DECLINED", eventDate: "2030-06-21", estimatedTotal: "500.00" }),
      record({ status: "CANCELLED", eventDate: "2030-06-22", estimatedTotal: "500.00" }),
      record({ status: "DRAFT", eventDate: "2030-06-23", estimatedTotal: "500.00" })
    ]);

    expect(dashboard.month).toEqual({ start: "2030-06-01", end: "2030-06-30" });
    expect(dashboard.stats.revenue).toEqual({
      month: { cents: 49_010, amount: "490.10" },
      completed: { cents: 12_010, amount: "120.10" },
      upcoming: { cents: 37_000, amount: "370.00" },
      orderCount: 2
    });
  });

  it("adds money in cents without floating-point drift", () => {
    const dashboard = summarize([
      record({ status: "ACCEPTED", eventDate: "2030-06-14", estimatedTotal: "0.10" }),
      record({ status: "ACCEPTED", eventDate: "2030-06-15", estimatedTotal: "0.20" })
    ]);
    expect(dashboard.stats.revenue.month).toEqual({ cents: 30, amount: "0.30" });
  });

  it("counts distinct booked customers overall and this month", () => {
    const repeatCustomer = "11000000-0000-4000-8000-000000000006";
    const pastCustomer = "11000000-0000-4000-8000-000000000007";
    const requestingCustomer = "11000000-0000-4000-8000-000000000008";
    const dashboard = summarize([
      record({ status: "ACCEPTED", eventDate: "2030-06-14", customerId: repeatCustomer }),
      record({ status: "COMPLETED", eventDate: "2030-06-02", customerId: repeatCustomer }),
      record({ status: "COMPLETED", eventDate: "2030-04-02", customerId: pastCustomer }),
      record({ status: "REQUESTED", eventDate: "2030-06-20", customerId: requestingCustomer })
    ]);

    expect(dashboard.stats.customers).toEqual({ total: 2, bookedThisMonth: 1 });
  });

  it("lists accepted orders from today on as upcoming orders to fill", () => {
    const dashboard = summarize([
      record({ status: "ACCEPTED", eventDate: "2030-07-16", guestCount: 30 }),
      record({ status: "ACCEPTED", eventDate: "2030-06-12", guestCount: 12 }),
      record({ status: "ACCEPTED", eventDate: "2030-06-11", guestCount: 99 }),
      record({ status: "COMPLETED", eventDate: "2030-06-13", guestCount: 99 }),
      record({ status: "REQUESTED", eventDate: "2030-06-13", guestCount: 99 })
    ]);

    expect(dashboard.stats.ordersToFill).toEqual({
      count: 2,
      guestCount: 42,
      nextEventDate: "2030-06-12"
    });
    expect(dashboard.upcoming.map((order) => [order.eventDate, order.status])).toEqual([
      ["2030-06-12", "ACCEPTED"],
      ["2030-07-16", "ACCEPTED"]
    ]);
  });

  it("puts closed and past orders in history, newest first, and hides drafts", () => {
    const dashboard = summarize([
      record({ status: "COMPLETED", eventDate: "2030-06-03" }),
      record({ status: "DECLINED", eventDate: "2030-06-21" }),
      record({ status: "CANCELLED", eventDate: "2030-06-22" }),
      record({ status: "ACCEPTED", eventDate: "2030-06-11" }),
      record({ status: "ACCEPTED", eventDate: "2030-06-14" }),
      record({ status: "REQUESTED", eventDate: "2030-06-20" }),
      record({ status: "DRAFT", eventDate: "2030-06-23" })
    ]);

    expect(dashboard.history.map((order) => [order.eventDate, order.status])).toEqual([
      ["2030-06-22", "CANCELLED"],
      ["2030-06-21", "DECLINED"],
      ["2030-06-11", "ACCEPTED"],
      ["2030-06-03", "COMPLETED"]
    ]);
    const listed = [...dashboard.upcoming, ...dashboard.pendingRequests, ...dashboard.history];
    expect(listed).toHaveLength(6);
    expect(listed.some((order) => order.status === "DRAFT")).toBe(false);
  });

  it("lists pending requests by event date with stored line prices", () => {
    const dashboard = summarize([
      record(
        {
          status: "REQUESTED",
          eventDate: "2030-06-28",
          estimatedTotal: "370.00",
          fulfillmentMethod: "DELIVERY",
          dietaryRestrictions: ["VEGETARIAN"]
        },
        [[dumplingsId, 30, "11.25"]]
      ),
      record({ status: "REQUESTED", eventDate: "2030-06-18" }),
      record({ status: "ACCEPTED", eventDate: "2030-06-18" })
    ]);

    expect(dashboard.stats.pendingRequests.count).toBe(2);
    expect(dashboard.pendingRequests.map((order) => order.eventDate)).toEqual([
      "2030-06-18",
      "2030-06-28"
    ]);
    const deliveryRequest = dashboard.pendingRequests[1]!;
    expect(deliveryRequest.dietaryRestrictions).toEqual(["VEGETARIAN"]);
    expect(deliveryRequest.lines).toEqual([
      {
        menuItemId: dumplingsId,
        name: "Vegetable Dumplings",
        quantity: 30,
        unitPrice: { cents: 1_125, amount: "11.25" },
        lineTotal: { cents: 33_750, amount: "337.50" }
      }
    ]);
    expect(deliveryRequest.subtotal).toEqual({ cents: 33_750, amount: "337.50" });
    expect(deliveryRequest.total).toEqual({ cents: 37_000, amount: "370.00" });
  });

  it("shows each availability day as open, closed, or not set", () => {
    const dashboard = summarize(
      [
        record({ status: "ACCEPTED", eventDate: "2030-06-14", guestCount: 30 }),
        record({ status: "REQUESTED", eventDate: "2030-06-14", guestCount: 40 })
      ],
      {
        availability: [
          { catererId, date: "2030-06-12", available: true, capacityOverride: 40 },
          { catererId, date: "2030-06-13", available: false, capacityOverride: null },
          { catererId, date: "2030-06-14", available: true, capacityOverride: null },
          { catererId: otherCatererId, date: "2030-06-15", available: true, capacityOverride: 9 },
          { catererId, date: "2030-06-30", available: true, capacityOverride: 9 }
        ]
      }
    );

    expect(dashboard.availability.period).toEqual({ start: "2030-06-12", end: "2030-06-25" });
    expect(dashboard.availability.days).toHaveLength(14);
    expect(dashboard.availability.days.slice(0, 4)).toEqual([
      { date: "2030-06-12", status: "OPEN", capacity: 40, bookedGuests: 0 },
      { date: "2030-06-13", status: "CLOSED", capacity: null, bookedGuests: 0 },
      { date: "2030-06-14", status: "OPEN", capacity: 85, bookedGuests: 30 },
      { date: "2030-06-15", status: "NOT_SET", capacity: null, bookedGuests: 0 }
    ]);
    expect(dashboard.availability.days.at(-1)).toEqual({
      date: "2030-06-25",
      status: "NOT_SET",
      capacity: null,
      bookedGuests: 0
    });
  });

  it("lists the whole menu ranked by servings booked, with inactive items last", () => {
    const dashboard = summarize([
      record({ status: "COMPLETED", eventDate: "2030-03-01" }, [
        [dumplingsId, 20],
        [friedRiceId, 5],
        [retiredItemId, 100]
      ]),
      record({ status: "ACCEPTED", eventDate: "2030-06-14" }, [[friedRiceId, 30]]),
      record({ status: "REQUESTED", eventDate: "2030-06-20" }, [[dumplingsId, 500]])
    ]);

    expect(
      dashboard.menu.map((item) => [item.name, item.servingsBooked, item.orderCount, item.active])
    ).toEqual([
      ["Ginger Scallion Fried Rice", 35, 2, true],
      ["Vegetable Dumplings", 20, 1, true],
      ["Five-Spice Chicken", 0, 0, true],
      ["Retired Special", 100, 1, false]
    ]);
    expect(dashboard.menu[0]).toEqual({
      menuItemId: friedRiceId,
      name: "Ginger Scallion Fried Rice",
      description: "Wok-tossed rice.",
      price: { cents: 1_000, amount: "10.00" },
      dietaryTags: ["VEGETARIAN", "VEGAN", "GLUTEN_FREE"],
      active: true,
      servingsBooked: 35,
      orderCount: 2
    });
  });

  it("ignores orders, menu items, and availability that belong to another caterer", () => {
    const dashboard = summarize(
      [
        record({ status: "ACCEPTED", eventDate: "2030-06-14", catererId: otherCatererId }),
        record({ status: "REQUESTED", eventDate: "2030-06-14", catererId: otherCatererId }),
        record({ status: "COMPLETED", eventDate: "2030-06-01", catererId: otherCatererId })
      ],
      {
        menu: [{ ...menu[0]!, catererId: otherCatererId }],
        availability: [
          { catererId: otherCatererId, date: "2030-06-12", available: true, capacityOverride: 5 }
        ]
      }
    );

    expect(dashboard.stats.revenue.orderCount).toBe(0);
    expect(dashboard.stats.pendingRequests.count).toBe(0);
    expect(dashboard.upcoming).toEqual([]);
    expect(dashboard.history).toEqual([]);
    expect(dashboard.menu).toEqual([]);
    expect(dashboard.availability.days[0]?.status).toBe("NOT_SET");
  });

  it("returns an empty dashboard for a caterer without orders", () => {
    const dashboard = summarize([], { menu: [] });

    expect(dashboard.caterer).toEqual({
      id: catererId,
      businessName: "Test Kitchen",
      ownerName: "Avery Lin",
      location: "Ann Arbor, MI",
      cuisineTypes: ["CHINESE"],
      maximumCapacity: 85,
      active: true
    });
    expect(dashboard.stats).toEqual({
      customers: { total: 0, bookedThisMonth: 0 },
      revenue: {
        month: { cents: 0, amount: "0.00" },
        completed: { cents: 0, amount: "0.00" },
        upcoming: { cents: 0, amount: "0.00" },
        orderCount: 0
      },
      ordersToFill: { count: 0, guestCount: 0, nextEventDate: null },
      pendingRequests: { count: 0 }
    });
    expect(dashboard.upcoming).toEqual([]);
    expect(dashboard.pendingRequests).toEqual([]);
    expect(dashboard.history).toEqual([]);
    expect(dashboard.menu).toEqual([]);
    expect(dashboard.availability.days.every((day) => day.status === "NOT_SET")).toBe(true);
  });
});
