import type {
  Availability,
  Caterer,
  MenuItem,
  Order,
  OrderItem,
  OrderStatus
} from "../types/domain.js";
import { centsToMoney, moneyToCents } from "./money.js";

/** Orders a caterer has committed to. Only these count toward customers and revenue. */
export const bookedOrderStatuses: readonly OrderStatus[] = ["ACCEPTED", "COMPLETED"];

/** Number of days of availability shown, starting today. */
export const availabilityWindowDays = 14;

export interface MoneyAmount {
  cents: number;
  amount: string;
}

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
    customers: { total: number; bookedThisMonth: number };
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

function toMoneyAmount(cents: number): MoneyAmount {
  return { cents, amount: centsToMoney(cents) };
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

/** Lists every menu item, active first, ranked by servings in booked orders. */
function summarizeMenu(
  source: DashboardSource,
  booked: readonly DashboardOrderRecord[]
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

  return source.menu
    .filter((item) => item.catererId === source.caterer.id)
    .map((item) => ({
      menuItemId: item.id,
      name: item.name,
      description: item.description,
      price: toMoneyAmount(moneyToCents(item.price)),
      dietaryTags: item.dietaryTags,
      active: item.active,
      ...(usage.get(item.id) ?? { servingsBooked: 0, orderCount: 0 })
    }))
    .sort(
      (left, right) =>
        Number(right.active) - Number(left.active) ||
        right.servingsBooked - left.servingsBooked ||
        left.name.localeCompare(right.name)
    );
}

/**
 * Summarizes one caterer's orders, availability, and menu for their dashboard.
 * Draft orders are excluded because the customer has not sent them yet. Revenue
 * is the stored order total of booked orders whose event date falls in the
 * current month.
 */
export function summarizeCatererDashboard(source: DashboardSource): CatererDashboard {
  const { today } = source;
  const month = monthContaining(today);
  const period = availabilityPeriod(today);
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
        bookedThisMonth: countDistinctCustomers(bookedThisMonth)
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
    menu: summarizeMenu(source, booked)
  };
}
