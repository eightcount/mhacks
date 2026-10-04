import { describe, expect, it } from "vitest";
import type { Order, OrderStatus } from "../src/types/domain.js";
import {
  availabilityPeriod,
  monthContaining,
  summarizeCatererDashboard,
  type DashboardOrderRecord,
  type DashboardSource
} from "../src/services/dashboard-summary.js";
import type {
  PreorderRecord,
  PreorderSource,
  ProductSpecRecord
} from "../src/services/dashboard-preorders.js";
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

function operations(overrides: Partial<PreorderSource> = {}): PreorderSource {
  return {
    forms: [],
    preorders: [],
    notifications: [],
    productSpecs: [],
    now: new Date("2030-06-12T12:00:00.000Z"),
    ...overrides
  };
}

let preorderSequence = 0;

function preorder(overrides: Partial<PreorderRecord> & Pick<PreorderRecord, "status" | "fulfillmentDate">): PreorderRecord {
  preorderSequence += 1;
  return {
    id: `8c000000-0000-4000-8000-${String(preorderSequence).padStart(12, "0")}`,
    formId: "8b000000-0000-4000-8000-000000000001",
    catererId,
    submissionId: `8e000000-0000-4000-8000-${String(preorderSequence).padStart(12, "0")}`,
    customerName: "Harper Quill",
    customerContact: "test:customer:preorder",
    deliveryAddress: "",
    items: [],
    total: "0.00",
    createdAt: new Date("2030-06-01T00:00:00.000Z"),
    updatedAt: new Date("2030-06-01T00:00:00.000Z"),
    ...overrides
  };
}

function productSpec(menuItemId: string, container: string, createdAt: Date): ProductSpecRecord {
  return {
    id: `8a000000-0000-4000-8000-${String(createdAt.getTime()).slice(-12)}`,
    catererId,
    menuItemId,
    productName: menuNames[menuItemId] ?? "Item",
    spec: {
      menuItemId,
      container: { name: container, capacity: { amount: "12", unit: "each" }, fill: { amount: "12", unit: "each" } },
      recipe: {
        name: "Fictional recipe",
        yield: { amount: "60", unit: "each" },
        ingredients: [{ name: "Flour", measure: { amount: "500", unit: "g" } }],
        allergens: ["wheat"],
        storageInstructions: "Refrigerate"
      }
    },
    createdAt
  };
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

    expect(dashboard.stats.customers).toEqual({ total: 2, bookedThisMonth: 1, repeat: 1 });
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
      orderCount: 2,
      recipe: null
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

  it("charts booked catering and preorder value by month around today", () => {
    const dashboard = summarize(
      [
        record({ status: "COMPLETED", eventDate: "2030-01-10", estimatedTotal: "100.00" }),
        record({ status: "COMPLETED", eventDate: "2030-03-01", estimatedTotal: "250.50" }),
        record({ status: "ACCEPTED", eventDate: "2030-07-04", estimatedTotal: "80.00" }),
        record({ status: "REQUESTED", eventDate: "2030-06-20", estimatedTotal: "999.00" }),
        record({ status: "COMPLETED", eventDate: "2029-12-31", estimatedTotal: "999.00" })
      ],
      {
        operations: operations({
          preorders: [
            preorder({ status: "COMPLETED", fulfillmentDate: "2030-06-02", total: "40.25" }),
            preorder({ status: "DECLINED", fulfillmentDate: "2030-06-05", total: "999.00" })
          ]
        })
      }
    );

    expect(dashboard.trend.map((month) => month.month)).toEqual([
      "2030-01", "2030-02", "2030-03", "2030-04", "2030-05", "2030-06", "2030-07", "2030-08"
    ]);
    expect(dashboard.trend.map((month) => month.total.amount)).toEqual([
      "100.00", "0.00", "250.50", "0.00", "0.00", "40.25", "80.00", "0.00"
    ]);
    expect(dashboard.trend[5]).toMatchObject({
      catering: { cents: 0 },
      preorders: { cents: 4_025 },
      orderCount: 0,
      preorderCount: 1
    });
  });

  it("reports the order pipeline, acceptance rate, and booked averages", () => {
    const dashboard = summarize([
      record({ status: "COMPLETED", eventDate: "2030-05-01", estimatedTotal: "100.00", guestCount: 10 }),
      record({ status: "ACCEPTED", eventDate: "2030-06-20", estimatedTotal: "200.01", guestCount: 25 }),
      record({ status: "DECLINED", eventDate: "2030-06-21" }),
      record({ status: "CANCELLED", eventDate: "2030-06-22" }),
      record({ status: "REQUESTED", eventDate: "2030-06-23" }),
      record({ status: "DRAFT", eventDate: "2030-06-24" })
    ]);

    expect(dashboard.pipeline).toEqual({
      counts: { REQUESTED: 1, ACCEPTED: 1, COMPLETED: 1, DECLINED: 1, CANCELLED: 1 },
      acceptanceRate: 67,
      averageOrderValue: { cents: 15_001, amount: "150.01" },
      averageGuestCount: 18
    });
  });

  it("counts requested event styles, fulfillment, and dietary needs, most common first", () => {
    const dashboard = summarize([
      record({ status: "REQUESTED", eventDate: "2030-06-20", eventStyle: "FORMAL", dietaryRestrictions: ["VEGAN", "GLUTEN_FREE"] }),
      record({ status: "COMPLETED", eventDate: "2030-05-01", eventStyle: "BUFFET", fulfillmentMethod: "DELIVERY", dietaryRestrictions: ["VEGAN"] }),
      record({ status: "DECLINED", eventDate: "2030-06-21", eventStyle: "BUFFET" }),
      record({ status: "DRAFT", eventDate: "2030-06-24", eventStyle: "CASUAL", dietaryRestrictions: ["HALAL"] })
    ]);

    expect(dashboard.mix).toEqual({
      eventStyles: [{ value: "BUFFET", count: 2 }, { value: "FORMAL", count: 1 }],
      fulfillment: [{ value: "PICKUP", count: 2 }, { value: "DELIVERY", count: 1 }],
      dietary: [{ value: "VEGAN", count: 2 }, { value: "GLUTEN_FREE", count: 1 }]
    });
  });

  it("ranks customers by booked value and counts repeat customers", () => {
    const regular = "11000000-0000-4000-8000-000000000006";
    const big = "11000000-0000-4000-8000-000000000007";
    const dashboard = summarize([
      { ...record({ status: "COMPLETED", eventDate: "2030-02-01", customerId: regular, estimatedTotal: "100.00" }), customerName: "River Stone" },
      { ...record({ status: "ACCEPTED", eventDate: "2030-06-30", customerId: regular, estimatedTotal: "50.00" }), customerName: "River Stone" },
      { ...record({ status: "COMPLETED", eventDate: "2030-04-01", customerId: big, estimatedTotal: "400.00" }), customerName: "Dana Cloud" },
      { ...record({ status: "REQUESTED", eventDate: "2030-07-01", customerId: big, estimatedTotal: "900.00" }), customerName: "Dana Cloud" }
    ]);

    expect(dashboard.topCustomers).toEqual([
      { customerId: big, name: "Dana Cloud", orderCount: 1, total: { cents: 40_000, amount: "400.00" }, lastEventDate: "2030-04-01" },
      { customerId: regular, name: "River Stone", orderCount: 2, total: { cents: 15_000, amount: "150.00" }, lastEventDate: "2030-06-30" }
    ]);
    expect(dashboard.stats.customers.repeat).toBe(1);
  });

  it("shows each menu item's newest recipe and container", () => {
    const dashboard = summarize([], {
      operations: operations({
        productSpecs: [
          productSpec(dumplingsId, "old box", new Date("2030-01-01")),
          productSpec(dumplingsId, "12-piece box", new Date("2030-02-01")),
          { ...productSpec(friedRiceId, "other caterer box", new Date("2030-03-01")), catererId: otherCatererId }
        ]
      })
    });

    const recipes = Object.fromEntries(dashboard.menu.map((item) => [item.name, item.recipe]));
    expect(recipes["Vegetable Dumplings"]).toEqual({ container: "12-piece box (12 each)", allergens: ["wheat"] });
    expect(recipes["Ginger Scallion Fried Rice"]).toBeNull();
  });

  it("lists the week's menu with servings and preorder packages booked in the next seven days", () => {
    const dumplingSpec = productSpec(dumplingsId, "12-piece box", new Date("2030-02-01"));
    const dashboard = summarize(
      [
        record({ status: "ACCEPTED", eventDate: "2030-06-14" }, [[dumplingsId, 10], [friedRiceId, 5]]),
        record({ status: "ACCEPTED", eventDate: "2030-06-18" }, [[dumplingsId, 4]]),
        record({ status: "ACCEPTED", eventDate: "2030-06-19" }, [[dumplingsId, 100]]),
        record({ status: "REQUESTED", eventDate: "2030-06-13" }, [[chickenId, 50]]),
        record({ status: "COMPLETED", eventDate: "2030-06-01" }, [[chickenId, 70]])
      ],
      {
        operations: operations({
          productSpecs: [dumplingSpec],
          preorders: [
            preorder({
              status: "ACCEPTED",
              fulfillmentDate: "2030-06-15",
              items: [{ productSpecId: dumplingSpec.id, name: "Vegetable Dumplings", unitPrice: "11.50", container: "12-piece box (12 each)", quantity: 3 }]
            }),
            preorder({
              status: "REQUESTED",
              fulfillmentDate: "2030-06-15",
              items: [{ productSpecId: dumplingSpec.id, name: "Vegetable Dumplings", unitPrice: "11.50", container: "12-piece box (12 each)", quantity: 40 }]
            })
          ]
        })
      }
    );

    expect(dashboard.weekMenu.period).toEqual({ start: "2030-06-12", end: "2030-06-18" });
    expect(
      dashboard.weekMenu.items.map((item) => [item.name, item.servings, item.orderCount, item.preorderPackages])
    ).toEqual([
      ["Vegetable Dumplings", 14, 2, 3],
      ["Ginger Scallion Fried Rice", 5, 1, 0],
      ["Five-Spice Chicken", 0, 0, 0]
    ]);
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
      customers: { total: 0, bookedThisMonth: 0, repeat: 0 },
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
    expect(dashboard.trend.every((month) => month.total.cents === 0)).toBe(true);
    expect(dashboard.pipeline).toEqual({
      counts: { REQUESTED: 0, ACCEPTED: 0, COMPLETED: 0, DECLINED: 0, CANCELLED: 0 },
      acceptanceRate: null,
      averageOrderValue: null,
      averageGuestCount: null
    });
    expect(dashboard.mix).toEqual({ eventStyles: [], fulfillment: [], dietary: [] });
    expect(dashboard.topCustomers).toEqual([]);
    expect(dashboard.weekMenu.items).toEqual([]);
    expect(dashboard.preorders.forms).toEqual([]);
    expect(dashboard.preorders.production).toEqual([]);
  });
});
