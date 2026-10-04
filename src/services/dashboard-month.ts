import {
  bookedPreorderStatuses,
  type DashboardPreorder
} from "./dashboard-preorders.js";
import {
  bookedOrderStatuses,
  byEventDate,
  datesIn,
  isWithin,
  monthContaining,
  shiftMonth,
  toDashboardOrder,
  type CatererDashboard,
  type DashboardOrder,
  type DashboardOrderRecord,
  type DashboardPeriod,
  type DashboardSource
} from "./dashboard-summary.js";
import { moneyToCents, toMoneyAmount, type MoneyAmount } from "./money.js";

/** Months in each detail chart, ending with the selected month. */
export const monthTrendLength = 6;

/** How far back the month picker reaches. */
export const monthHistoryLimit = 24;

export interface DashboardMonthTrendPoint {
  /** YYYY-MM */
  month: string;
  catering: MoneyAmount;
  preorders: MoneyAmount;
  total: MoneyAmount;
  /** Customers whose first booked order is in this month. */
  newCustomers: number;
  /** Customers with a booked order this month and one in an earlier month. */
  returningCustomers: number;
}

export interface DashboardMonthCustomer {
  customerId: string;
  name: string;
  /** Booked orders with an event date in the selected month. */
  orderCount: number;
  total: MoneyAmount;
  lifetimeOrderCount: number;
  /** True when the customer's first booked order is in the selected month. */
  isNew: boolean;
}

export interface DashboardGuestDay {
  date: string;
  /** Guests in accepted orders that day. */
  toFill: number;
  /** Guests in completed orders that day. */
  filled: number;
}

/** The four dashboard figures and their details for one calendar month. */
export interface DashboardMonthView {
  /** YYYY-MM */
  month: string;
  period: DashboardPeriod;
  isCurrent: boolean;
  /** Months the picker offers, oldest first, ending with the current month. */
  months: string[];
  trend: DashboardMonthTrendPoint[];
  revenue: {
    /** Booked catering orders with an event date in the month. */
    total: MoneyAmount;
    completed: MoneyAmount;
    toFill: MoneyAmount;
    /** Booked preorders with a fulfillment date in the month, reported separately. */
    preorders: MoneyAmount;
    preorderCount: number;
    orders: DashboardOrder[];
  };
  ordersToFill: {
    count: number;
    guestCount: number;
    /** The first accepted event from today on, if one is in this month. */
    nextEventDate: string | null;
    orders: DashboardOrder[];
    filled: DashboardOrder[];
    days: DashboardGuestDay[];
  };
  awaiting: {
    count: number;
    requests: DashboardOrder[];
    preorders: DashboardPreorder[];
  };
  customers: {
    count: number;
    newCount: number;
    returningCount: number;
    customers: DashboardMonthCustomer[];
  };
}

export type CatererDashboardView = CatererDashboard & { monthView: DashboardMonthView };

function periodOf(yearMonth: string): DashboardPeriod {
  return monthContaining(`${yearMonth}-01`);
}

function sumOrders(records: readonly DashboardOrderRecord[]): MoneyAmount {
  return toMoneyAmount(
    records.reduce((total, { order }) => total + moneyToCents(order.estimatedTotal), 0)
  );
}

function sumPreorders(preorders: readonly DashboardPreorder[]): MoneyAmount {
  return toMoneyAmount(preorders.reduce((total, order) => total + order.total.cents, 0));
}

function sumGuests(records: readonly DashboardOrderRecord[]): number {
  return records.reduce((total, { order }) => total + order.guestCount, 0);
}

/** Months from the oldest order (at most `monthHistoryLimit` back) through the current month. */
function selectableMonths(
  records: readonly DashboardOrderRecord[],
  preorders: readonly DashboardPreorder[],
  currentMonth: string,
  selected: string
): string[] {
  const earliestAllowed = shiftMonth(currentMonth, -(monthHistoryLimit - 1));
  const earliestData = [
    ...records.map(({ order }) => order.eventDate.slice(0, 7)),
    ...preorders.map((order) => order.fulfillmentDate.slice(0, 7))
  ].filter((month) => month <= currentMonth).sort()[0] ?? currentMonth;
  const start = earliestData < earliestAllowed ? earliestAllowed : earliestData;

  const months: string[] = [];
  for (let month = start; month <= currentMonth; month = shiftMonth(month, 1)) {
    months.push(month);
  }
  return months.includes(selected) ? months : [...months, selected].sort();
}

/**
 * Summarizes one month for the dashboard's four figures and their detail
 * views. Orders count toward the month of their event date and preorders
 * toward the month of their fulfillment date. Draft orders are excluded.
 */
export function summarizeMonthView(
  source: DashboardSource,
  preorders: readonly DashboardPreorder[],
  month: string
): DashboardMonthView {
  const period = periodOf(month);
  const currentMonth = source.today.slice(0, 7);
  const records = source.orders
    .filter(({ order }) => order.catererId === source.caterer.id && order.status !== "DRAFT")
    .sort(byEventDate);
  const booked = records.filter(({ order }) => bookedOrderStatuses.includes(order.status));
  const bookedPreorders = preorders.filter((order) => bookedPreorderStatuses.includes(order.status));
  const inMonth = (records: readonly DashboardOrderRecord[], target: DashboardPeriod = period) =>
    records.filter(({ order }) => isWithin(order.eventDate, target));

  // A customer is new in the month of their first booked event.
  const firstMonth = new Map<string, string>();
  const lifetimeOrders = new Map<string, number>();
  for (const { order } of booked) {
    const prior = firstMonth.get(order.customerId);
    if (!prior || order.eventDate.slice(0, 7) < prior) {
      firstMonth.set(order.customerId, order.eventDate.slice(0, 7));
    }
    lifetimeOrders.set(order.customerId, (lifetimeOrders.get(order.customerId) ?? 0) + 1);
  }
  const customerSplit = (monthBooked: readonly DashboardOrderRecord[], yearMonth: string) => {
    const ids = new Set(monthBooked.map(({ order }) => order.customerId));
    const newIds = [...ids].filter((id) => firstMonth.get(id) === yearMonth);
    return { ids, newCount: newIds.length, returningCount: ids.size - newIds.length };
  };

  const trend = Array.from({ length: monthTrendLength }, (_, index) => {
    const trendMonth = shiftMonth(month, index - (monthTrendLength - 1));
    const trendPeriod = periodOf(trendMonth);
    const monthBooked = inMonth(booked, trendPeriod);
    const catering = sumOrders(monthBooked);
    const preorderTotal = sumPreorders(
      bookedPreorders.filter((order) => isWithin(order.fulfillmentDate, trendPeriod))
    );
    const split = customerSplit(monthBooked, trendMonth);
    return {
      month: trendMonth,
      catering,
      preorders: preorderTotal,
      total: toMoneyAmount(catering.cents + preorderTotal.cents),
      newCustomers: split.newCount,
      returningCustomers: split.returningCount
    };
  });

  const bookedThisMonth = inMonth(booked);
  const toFill = bookedThisMonth.filter(({ order }) => order.status === "ACCEPTED");
  const filled = bookedThisMonth.filter(({ order }) => order.status === "COMPLETED");
  const monthPreorders = bookedPreorders.filter((order) => isWithin(order.fulfillmentDate, period));
  const requests = inMonth(records).filter(({ order }) => order.status === "REQUESTED");
  const preorderRequests = preorders.filter(
    (order) => order.status === "REQUESTED" && isWithin(order.fulfillmentDate, period)
  );

  const customerTotals = new Map<string, DashboardMonthCustomer>();
  for (const { order, customerName } of bookedThisMonth) {
    const entry = customerTotals.get(order.customerId) ?? {
      customerId: order.customerId,
      name: customerName,
      orderCount: 0,
      total: toMoneyAmount(0),
      lifetimeOrderCount: lifetimeOrders.get(order.customerId) ?? 0,
      isNew: firstMonth.get(order.customerId) === month
    };
    entry.orderCount += 1;
    entry.total = toMoneyAmount(entry.total.cents + moneyToCents(order.estimatedTotal));
    customerTotals.set(order.customerId, entry);
  }
  const split = customerSplit(bookedThisMonth, month);

  return {
    month,
    period,
    isCurrent: month === currentMonth,
    months: selectableMonths(records, preorders, currentMonth, month),
    trend,
    revenue: {
      total: sumOrders(bookedThisMonth),
      completed: sumOrders(filled),
      toFill: sumOrders(toFill),
      preorders: sumPreorders(monthPreorders),
      preorderCount: monthPreorders.length,
      orders: bookedThisMonth.map(toDashboardOrder)
    },
    ordersToFill: {
      count: toFill.length,
      guestCount: sumGuests(toFill),
      nextEventDate: toFill.find(({ order }) => order.eventDate >= source.today)?.order.eventDate ?? null,
      orders: toFill.map(toDashboardOrder),
      filled: filled.map(toDashboardOrder),
      days: datesIn(period).map((date) => ({
        date,
        toFill: sumGuests(toFill.filter(({ order }) => order.eventDate === date)),
        filled: sumGuests(filled.filter(({ order }) => order.eventDate === date))
      }))
    },
    awaiting: {
      count: requests.length + preorderRequests.length,
      requests: requests.map(toDashboardOrder),
      preorders: preorderRequests
    },
    customers: {
      count: split.ids.size,
      newCount: split.newCount,
      returningCount: split.returningCount,
      customers: [...customerTotals.values()].sort(
        (left, right) =>
          right.total.cents - left.total.cents ||
          right.orderCount - left.orderCount ||
          left.name.localeCompare(right.name)
      )
    }
  };
}
