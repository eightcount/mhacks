import type {
  Availability,
  Caterer,
  MenuItem,
  Order,
  OrderItem,
  OrderStatus
} from "../types/domain.js";
import {
  bookedPreorderStatuses,
  summarizePreorders,
  type PreorderDashboard,
  type PreorderRecord,
  type PreorderSource,
  type ProductSpecRecord
} from "./dashboard-preorders.js";
import { moneyToCents, toMoneyAmount, type MoneyAmount } from "./money.js";

/** Orders a caterer has committed to. Only these count toward customers and revenue. */
export const bookedOrderStatuses: readonly OrderStatus[] = ["ACCEPTED", "COMPLETED"];

/** Number of days of availability shown, starting today. */
export const availabilityWindowDays = 14;

/** Number of days in "this week" for the weekly menu, starting today. */
export const menuWeekDays = 7;

/** Inclusive YYYY-MM-DD date range. */
export interface DashboardPeriod {
  start: string;
  end: string;
}

export interface DashboardOrderRecord {
  order: Order;
  customerName: string;
  items: ReadonlyArray<{
    item: OrderItem;
    menuItem: Pick<MenuItem, "name">;
  }>;
}

export interface DashboardSource {
  caterer: Pick<
    Caterer,
    "id" | "businessName" | "location" | "cuisineTypes" | "maximumCapacity" | "active"
  >;
  ownerName: string;
  orders: readonly DashboardOrderRecord[];
  /** The caterer's full menu, including inactive items. */
  menu: ReadonlyArray<
    Pick<MenuItem, "id" | "catererId" | "name" | "description" | "price" | "dietaryTags" | "active">
  >;
  /** Availability records covering at least `availabilityPeriod(today)`. */
  availability: ReadonlyArray<
    Pick<Availability, "catererId" | "date" | "available" | "capacityOverride">
  >;
  /** Order forms, preorders, notifications, and recipes; omitted means none. */
  operations?: PreorderSource;
  today: string;
}

export interface DashboardOrderLine {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: MoneyAmount;
  lineTotal: MoneyAmount;
}

export interface DashboardOrder {
  id: string;
  customerName: string;
  eventDate: string;
  guestCount: number;
  eventStyle: Order["eventStyle"];
  eventLocation: string;
  fulfillmentMethod: Order["fulfillmentMethod"];
  dietaryRestrictions: string[];
  status: OrderStatus;
  /** Sum of the order lines, before delivery fees. */
  subtotal: MoneyAmount;
  /** Stored order total, including any delivery fee. */
  total: MoneyAmount;
  lines: DashboardOrderLine[];
  specialRequests: string | null;
}

/** NOT_SET means the date has no availability record, which search treats as unavailable. */
export type DashboardAvailabilityStatus = "OPEN" | "CLOSED" | "NOT_SET";

export interface DashboardAvailabilityDay {
  date: string;
  status: DashboardAvailabilityStatus;
  /** Guest capacity on an open date: the date's override, else the caterer's maximum. */
  capacity: number | null;
  /** Guests in booked orders for this date. */
  bookedGuests: number;
}

export interface DashboardMenuItem {
  menuItemId: string;
  name: string;
  description: string;
  /** Current menu price. Order lines keep their own price snapshots. */
  price: MoneyAmount;
  dietaryTags: string[];
  active: boolean;
  /** Quantity ordered across booked orders. */
  servingsBooked: number;
  /** Booked orders that include this item. */
  orderCount: number;
  /** The item's latest recipe and container definition, if the caterer has saved one. */
  recipe: { container: string; allergens: string[] } | null;
}

export interface DashboardWeekMenuItem {
  menuItemId: string;
  name: string;
  description: string;
  price: MoneyAmount;
  dietaryTags: string[];
  active: boolean;
  /** Servings in booked catering orders with an event date this week. */
  servings: number;
  /** Booked catering orders this week that include the item. */
  orderCount: number;
  /** Packages in booked preorders with a fulfillment date this week. */
  preorderPackages: number;
}

/** Statuses an order can have once the customer has sent it. */
export const submittedOrderStatuses = [
  "REQUESTED",
  "ACCEPTED",
  "COMPLETED",
  "DECLINED",
  "CANCELLED"
] as const satisfies readonly OrderStatus[];
export type SubmittedOrderStatus = (typeof submittedOrderStatuses)[number];

/** Number of months in the revenue trend: five before the current month, the current month, and two ahead. */
export const trendMonthsBefore = 5;
export const trendMonthsAfter = 2;

/** Number of customers listed by booked value. */
export const topCustomersShown = 5;

export interface DashboardTrendMonth {
  /** YYYY-MM */
  month: string;
  /** Booked catering orders with an event date in the month. */
  catering: MoneyAmount;
  /** Booked preorders with a fulfillment date in the month. */
  preorders: MoneyAmount;
  total: MoneyAmount;
  orderCount: number;
  preorderCount: number;
}

export interface DashboardMixEntry {
  value: string;
  count: number;
}

export interface DashboardCustomer {
  customerId: string;
  name: string;
  orderCount: number;
  total: MoneyAmount;
  lastEventDate: string;
}

export interface CatererDashboard {
  caterer: {
    id: string;
    businessName: string;
    ownerName: string;
    location: string;
    cuisineTypes: string[];
    maximumCapacity: number;
    active: boolean;
  };
  today: string;
  month: DashboardPeriod;
  stats: {
    /** `repeat` counts customers with more than one booked order. */
    customers: { total: number; bookedThisMonth: number; repeat: number };
    revenue: {
      month: MoneyAmount;
      completed: MoneyAmount;
      upcoming: MoneyAmount;
      orderCount: number;
    };
    ordersToFill: { count: number; guestCount: number; nextEventDate: string | null };
    pendingRequests: { count: number };
  };
  /** Accepted orders with an event date from today on. */
  upcoming: DashboardOrder[];
  pendingRequests: DashboardOrder[];
  /** Completed, declined, and cancelled orders, plus accepted orders whose date has passed. */
  history: DashboardOrder[];
  availability: { period: DashboardPeriod; days: DashboardAvailabilityDay[] };
  menu: DashboardMenuItem[];
  /** Active menu items, plus anything booked, with what is booked this week. */
  weekMenu: { period: DashboardPeriod; items: DashboardWeekMenuItem[] };
  /** Booked value by month, oldest first. */
  trend: DashboardTrendMonth[];
  pipeline: {
    counts: Record<SubmittedOrderStatus, number>;
    /** Whole percent of answered requests that were accepted; null before any answer. */
    acceptanceRate: number | null;
    averageOrderValue: MoneyAmount | null;
    averageGuestCount: number | null;
  };
  /** What customers asked for across every submitted order, most common first. */
  mix: {
    eventStyles: DashboardMixEntry[];
    fulfillment: DashboardMixEntry[];
    dietary: DashboardMixEntry[];
  };
  /** Customers with the highest booked value. */
  topCustomers: DashboardCustomer[];
  preorders: PreorderDashboard;
}

function parseIsoDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    : null;

  if (!date || formatIsoDate(date) !== value) {
    throw new Error("Expected a real calendar date in YYYY-MM-DD format.");
  }
  return date;
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** The calendar month containing `today`. */
export function monthContaining(today: string): DashboardPeriod {
  const date = parseIsoDate(today);
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  return { start: formatIsoDate(first), end: formatIsoDate(last) };
}

/** This week for the weekly menu: `menuWeekDays` days starting today. */
export function menuWeekPeriod(today: string): DashboardPeriod {
  return {
    start: today,
    end: formatIsoDate(addDays(parseIsoDate(today), menuWeekDays - 1))
  };
}

/** The availability window: `availabilityWindowDays` days starting today. */
export function availabilityPeriod(today: string): DashboardPeriod {
  return {
    start: today,
    end: formatIsoDate(addDays(parseIsoDate(today), availabilityWindowDays - 1))
  };
}

function datesIn(period: DashboardPeriod): string[] {
  const dates: string[] = [];
  for (
    let date = parseIsoDate(period.start);
    formatIsoDate(date) <= period.end;
    date = addDays(date, 1)
  ) {
    dates.push(formatIsoDate(date));
  }
  return dates;
}

function isWithin(date: string, period: DashboardPeriod): boolean {
  return date >= period.start && date <= period.end;
}

function sumOrderTotals(records: readonly DashboardOrderRecord[]): MoneyAmount {
  return toMoneyAmount(
    records.reduce((total, { order }) => total + moneyToCents(order.estimatedTotal), 0)
  );
}

function sumGuests(records: readonly DashboardOrderRecord[]): number {
  return records.reduce((total, { order }) => total + order.guestCount, 0);
}

function countDistinctCustomers(records: readonly DashboardOrderRecord[]): number {
  return new Set(records.map(({ order }) => order.customerId)).size;
}

function byEventDate(left: DashboardOrderRecord, right: DashboardOrderRecord): number {
  return (
    left.order.eventDate.localeCompare(right.order.eventDate) ||
    left.order.createdAt.getTime() - right.order.createdAt.getTime()
  );
}

function toDashboardOrder({ order, customerName, items }: DashboardOrderRecord): DashboardOrder {
  const lines = items.map(({ item, menuItem }) => {
    const unitPriceCents = moneyToCents(item.unitPrice);
    return {
      menuItemId: item.menuItemId,
      name: menuItem.name,
      quantity: item.quantity,
      unitPrice: toMoneyAmount(unitPriceCents),
      lineTotal: toMoneyAmount(unitPriceCents * item.quantity)
    };
  });

  return {
    id: order.id,
    customerName,
    eventDate: order.eventDate,
    guestCount: order.guestCount,
    eventStyle: order.eventStyle,
    eventLocation: order.eventLocation,
    fulfillmentMethod: order.fulfillmentMethod,
    dietaryRestrictions: order.dietaryRestrictions,
    status: order.status,
    subtotal: toMoneyAmount(lines.reduce((total, line) => total + line.lineTotal.cents, 0)),
    total: toMoneyAmount(moneyToCents(order.estimatedTotal)),
    lines,
    specialRequests: order.specialRequests
  };
}

function summarizeAvailability(
  source: DashboardSource,
  period: DashboardPeriod,
  booked: readonly DashboardOrderRecord[]
): DashboardAvailabilityDay[] {
  const entries = new Map(
    source.availability
      .filter((entry) => entry.catererId === source.caterer.id)
      .map((entry) => [entry.date, entry])
  );

  return datesIn(period).map((date) => {
    const entry = entries.get(date);
    const bookedGuests = sumGuests(booked.filter(({ order }) => order.eventDate === date));
    if (!entry) {
      return { date, status: "NOT_SET", capacity: null, bookedGuests };
    }
    if (!entry.available) {
      return { date, status: "CLOSED", capacity: null, bookedGuests };
    }
    return {
      date,
      status: "OPEN",
      capacity: entry.capacityOverride ?? source.caterer.maximumCapacity,
      bookedGuests
    };
  });
}

function recipeSummary(spec: ProductSpecRecord["spec"]): DashboardMenuItem["recipe"] {
  const { name, fill } = spec.container;
  return { container: `${name} (${fill.amount} ${fill.unit})`, allergens: spec.recipe.allergens };
}

/** Lists every menu item, active first, ranked by servings in booked orders. */
function summarizeMenu(
  source: DashboardSource,
  booked: readonly DashboardOrderRecord[],
  productSpecs: readonly ProductSpecRecord[]
): DashboardMenuItem[] {
  const usage = new Map<string, { servingsBooked: number; orderCount: number }>();
  for (const { items } of booked) {
    for (const { item } of items) {
      const entry = usage.get(item.menuItemId) ?? { servingsBooked: 0, orderCount: 0 };
      entry.servingsBooked += item.quantity;
      entry.orderCount += 1;
      usage.set(item.menuItemId, entry);
    }
  }

  // Product definitions are immutable revisions; the newest one is current.
  const latestSpecs = new Map<string, ProductSpecRecord>();
  for (const spec of productSpecs) {
    if (spec.catererId !== source.caterer.id) continue;
    const prior = latestSpecs.get(spec.menuItemId);
    if (!prior || spec.createdAt.getTime() > prior.createdAt.getTime()) {
      latestSpecs.set(spec.menuItemId, spec);
    }
  }

  return source.menu
    .filter((item) => item.catererId === source.caterer.id)
    .map((item) => {
      const spec = latestSpecs.get(item.id);
      return {
        menuItemId: item.id,
        name: item.name,
        description: item.description,
        price: toMoneyAmount(moneyToCents(item.price)),
        dietaryTags: item.dietaryTags,
        active: item.active,
        ...(usage.get(item.id) ?? { servingsBooked: 0, orderCount: 0 }),
        recipe: spec ? recipeSummary(spec.spec) : null
      };
    })
    .sort(
      (left, right) =>
        Number(right.active) - Number(left.active) ||
        right.servingsBooked - left.servingsBooked ||
        left.name.localeCompare(right.name)
    );
}

/**
 * The caterer's menu for the week: every active item, plus any inactive item
 * that is still booked, with servings from booked catering orders and packages
 * from booked preorders whose date falls in the week. Busiest items first.
 */
function summarizeWeekMenu(
  source: DashboardSource,
  booked: readonly DashboardOrderRecord[],
  bookedPreorders: readonly PreorderRecord[],
  productSpecs: readonly ProductSpecRecord[],
  period: DashboardPeriod
): DashboardWeekMenuItem[] {
  const usage = new Map<string, { servings: number; orderCount: number; preorderPackages: number }>();
  const entry = (menuItemId: string) => {
    const current = usage.get(menuItemId) ?? { servings: 0, orderCount: 0, preorderPackages: 0 };
    usage.set(menuItemId, current);
    return current;
  };

  for (const { order, items } of booked) {
    if (!isWithin(order.eventDate, period)) continue;
    for (const { item } of items) {
      const current = entry(item.menuItemId);
      current.servings += item.quantity;
      current.orderCount += 1;
    }
  }

  const specMenuItems = new Map(
    productSpecs
      .filter((spec) => spec.catererId === source.caterer.id)
      .map((spec) => [spec.id, spec.menuItemId])
  );
  for (const order of bookedPreorders) {
    if (!isWithin(order.fulfillmentDate, period)) continue;
    for (const item of order.items) {
      const menuItemId = specMenuItems.get(item.productSpecId);
      if (menuItemId) entry(menuItemId).preorderPackages += item.quantity;
    }
  }

  return source.menu
    .filter((item) => item.catererId === source.caterer.id)
    .map((item) => ({
      menuItemId: item.id,
      name: item.name,
      description: item.description,
      price: toMoneyAmount(moneyToCents(item.price)),
      dietaryTags: item.dietaryTags,
      active: item.active,
      ...(usage.get(item.id) ?? { servings: 0, orderCount: 0, preorderPackages: 0 })
    }))
    .filter((item) => item.active || item.servings > 0 || item.preorderPackages > 0)
    .sort(
      (left, right) =>
        right.servings - left.servings ||
        right.preorderPackages - left.preorderPackages ||
        left.name.localeCompare(right.name)
    );
}

/** Shifts a YYYY-MM month by whole months. */
function shiftMonth(yearMonth: string, months: number): string {
  const date = parseIsoDate(`${yearMonth}-01`);
  return formatIsoDate(
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1))
  ).slice(0, 7);
}

function summarizeTrend(
  today: string,
  booked: readonly DashboardOrderRecord[],
  bookedPreorders: readonly PreorderRecord[]
): DashboardTrendMonth[] {
  const current = today.slice(0, 7);
  return Array.from({ length: trendMonthsBefore + 1 + trendMonthsAfter }, (_, index) => {
    const month = shiftMonth(current, index - trendMonthsBefore);
    const orders = booked.filter(({ order }) => order.eventDate.slice(0, 7) === month);
    const preorders = bookedPreorders.filter((order) => order.fulfillmentDate.slice(0, 7) === month);
    const cateringCents = sumOrderTotals(orders).cents;
    const preorderCents = preorders.reduce((total, order) => total + moneyToCents(order.total), 0);
    return {
      month,
      catering: toMoneyAmount(cateringCents),
      preorders: toMoneyAmount(preorderCents),
      total: toMoneyAmount(cateringCents + preorderCents),
      orderCount: orders.length,
      preorderCount: preorders.length
    };
  });
}

function summarizePipeline(
  records: readonly DashboardOrderRecord[],
  booked: readonly DashboardOrderRecord[]
): CatererDashboard["pipeline"] {
  const counts = Object.fromEntries(
    submittedOrderStatuses.map((status) => [status, 0])
  ) as Record<SubmittedOrderStatus, number>;
  for (const { order } of records) {
    const { status } = order;
    if (status !== "DRAFT") counts[status] += 1;
  }

  // Cancelled orders are left out: they may have been cancelled before or after acceptance.
  const accepted = counts.ACCEPTED + counts.COMPLETED;
  const answered = accepted + counts.DECLINED;
  return {
    counts,
    acceptanceRate: answered === 0 ? null : Math.round((accepted / answered) * 100),
    averageOrderValue: booked.length === 0
      ? null
      : toMoneyAmount(Math.round(sumOrderTotals(booked).cents / booked.length)),
    averageGuestCount: booked.length === 0 ? null : Math.round(sumGuests(booked) / booked.length)
  };
}

function countValues(values: readonly string[]): DashboardMixEntry[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

/** Every customer with a booked order, highest booked value first. */
function rankCustomers(booked: readonly DashboardOrderRecord[]): DashboardCustomer[] {
  const customers = new Map<string, DashboardCustomer>();
  for (const { order, customerName } of booked) {
    const entry = customers.get(order.customerId) ?? {
      customerId: order.customerId,
      name: customerName,
      orderCount: 0,
      total: toMoneyAmount(0),
      lastEventDate: order.eventDate
    };
    entry.orderCount += 1;
    entry.total = toMoneyAmount(entry.total.cents + moneyToCents(order.estimatedTotal));
    if (order.eventDate > entry.lastEventDate) entry.lastEventDate = order.eventDate;
    customers.set(order.customerId, entry);
  }
  return [...customers.values()].sort(
    (left, right) =>
      right.total.cents - left.total.cents ||
      right.orderCount - left.orderCount ||
      left.name.localeCompare(right.name)
  );
}

/**
 * Summarizes one caterer's orders, availability, menu, and preorders for their
 * dashboard. Draft orders are excluded because the customer has not sent them
 * yet. Revenue is the stored order total of booked orders whose event date
 * falls in the current month; preorder revenue is reported separately.
 */
export function summarizeCatererDashboard(source: DashboardSource): CatererDashboard {
  const { today } = source;
  const month = monthContaining(today);
  const period = availabilityPeriod(today);
  const operations: PreorderSource = source.operations ?? {
    forms: [],
    preorders: [],
    notifications: [],
    productSpecs: [],
    now: new Date(`${today}T12:00:00.000Z`)
  };
  const records = source.orders.filter(
    ({ order }) => order.catererId === source.caterer.id && order.status !== "DRAFT"
  );

  const isUpcoming = ({ order }: DashboardOrderRecord) =>
    order.status === "ACCEPTED" && order.eventDate >= today;
  const booked = records.filter(({ order }) => bookedOrderStatuses.includes(order.status));
  const bookedThisMonth = booked.filter(({ order }) => isWithin(order.eventDate, month));
  const completedThisMonth = bookedThisMonth.filter(({ order }) => order.status === "COMPLETED");
  const acceptedThisMonth = bookedThisMonth.filter(({ order }) => order.status === "ACCEPTED");
  const upcoming = records.filter(isUpcoming).sort(byEventDate);
  const pending = records.filter(({ order }) => order.status === "REQUESTED").sort(byEventDate);
  const history = records
    .filter((record) => record.order.status !== "REQUESTED" && !isUpcoming(record))
    .sort((left, right) => byEventDate(right, left));
  const customers = rankCustomers(booked);
  const bookedPreorders = operations.preorders.filter(
    (order) =>
      order.catererId === source.caterer.id && bookedPreorderStatuses.includes(order.status)
  );

  return {
    caterer: {
      id: source.caterer.id,
      businessName: source.caterer.businessName,
      ownerName: source.ownerName,
      location: source.caterer.location,
      cuisineTypes: source.caterer.cuisineTypes,
      maximumCapacity: source.caterer.maximumCapacity,
      active: source.caterer.active
    },
    today,
    month,
    stats: {
      customers: {
        total: countDistinctCustomers(booked),
        bookedThisMonth: countDistinctCustomers(bookedThisMonth),
        repeat: customers.filter((customer) => customer.orderCount > 1).length
      },
      revenue: {
        month: sumOrderTotals(bookedThisMonth),
        completed: sumOrderTotals(completedThisMonth),
        upcoming: sumOrderTotals(acceptedThisMonth),
        orderCount: bookedThisMonth.length
      },
      ordersToFill: {
        count: upcoming.length,
        guestCount: sumGuests(upcoming),
        nextEventDate: upcoming[0]?.order.eventDate ?? null
      },
      pendingRequests: { count: pending.length }
    },
    upcoming: upcoming.map(toDashboardOrder),
    pendingRequests: pending.map(toDashboardOrder),
    history: history.map(toDashboardOrder),
    availability: { period, days: summarizeAvailability(source, period, booked) },
    menu: summarizeMenu(source, booked, operations.productSpecs),
    weekMenu: {
      period: menuWeekPeriod(today),
      items: summarizeWeekMenu(
        source,
        booked,
        bookedPreorders,
        operations.productSpecs,
        menuWeekPeriod(today)
      )
    },
    trend: summarizeTrend(today, booked, bookedPreorders),
    pipeline: summarizePipeline(records, booked),
    mix: {
      eventStyles: countValues(records.map(({ order }) => order.eventStyle)),
      fulfillment: countValues(records.map(({ order }) => order.fulfillmentMethod)),
      dietary: countValues(records.flatMap(({ order }) => order.dietaryRestrictions))
    },
    topCustomers: customers.slice(0, topCustomersShown),
    preorders: summarizePreorders(source.caterer.id, operations, today, month)
  };
}
