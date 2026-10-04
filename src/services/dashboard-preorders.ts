import type {
  catererNotificationDrafts,
  catererOrderForms,
  catererPreorders,
  catererProductSpecs
} from "../db/schema/index.js";
import type { OrderStatus } from "../types/domain.js";
import { moneyToCents, toMoneyAmount, type MoneyAmount } from "./money.js";
import { calculateProduction, type ProductionLine } from "./production-math.js";

export type OrderFormRecord = typeof catererOrderForms.$inferSelect;
export type PreorderRecord = typeof catererPreorders.$inferSelect;
export type NotificationDraftRecord = typeof catererNotificationDrafts.$inferSelect;
export type ProductSpecRecord = typeof catererProductSpecs.$inferSelect;

/** Preorders a caterer has committed to. Only these count toward revenue and production. */
export const bookedPreorderStatuses: readonly OrderStatus[] = ["ACCEPTED", "COMPLETED"];

/** Preorders that hold packages on a form; matches `submitPreorder`'s reservation rule. */
const releasedPreorderStatuses: readonly OrderStatus[] = ["DECLINED", "CANCELLED"];

/** Number of upcoming fulfillment dates given a production plan. */
export const productionDaysShown = 4;

/** Number of notifications listed; counts still cover all of them. */
export const notificationsShown = 8;

export const notificationStatuses = ["DRAFT", "SENDING", "SENT", "FAILED"] as const;
export type NotificationStatus = (typeof notificationStatuses)[number];

export interface PreorderSource {
  forms: readonly OrderFormRecord[];
  preorders: readonly PreorderRecord[];
  notifications: readonly NotificationDraftRecord[];
  productSpecs: readonly ProductSpecRecord[];
  /** Compared against each form's `closesAt` to decide whether it is still open. */
  now: Date;
}

/**
 * OPEN: taking preorders. CLOSED: no longer taking preorders, fulfillment ahead.
 * PAST: the fulfillment date has passed. INACTIVE: turned off by the caterer.
 */
export type OrderFormState = "OPEN" | "CLOSED" | "PAST" | "INACTIVE";

export interface DashboardFormProduct {
  productSpecId: string;
  name: string;
  container: string;
  unitPrice: MoneyAmount;
  maxPackages: number;
  /** Packages held by requested, accepted, and completed preorders. */
  reservedPackages: number;
}

export interface DashboardOrderForm {
  id: string;
  title: string;
  state: OrderFormState;
  fulfillmentDate: string;
  closesAt: string;
  fulfillmentMethod: OrderFormRecord["fulfillmentMethod"];
  fulfillmentInstructions: string;
  minimumOrder: MoneyAmount;
  deliveryFee: MoneyAmount;
  products: DashboardFormProduct[];
  preorderCount: number;
  awaitingReply: number;
  /** Stored totals of accepted and completed preorders on this form. */
  bookedTotal: MoneyAmount;
}

export interface DashboardPreorderLine {
  name: string;
  container: string;
  quantity: number;
  unitPrice: MoneyAmount;
  lineTotal: MoneyAmount;
}

export interface DashboardPreorder {
  id: string;
  formId: string;
  formTitle: string;
  customerName: string;
  fulfillmentDate: string;
  deliveryAddress: string;
  status: OrderStatus;
  lines: DashboardPreorderLine[];
  total: MoneyAmount;
  /** UTC date the customer submitted the preorder. */
  requestedOn: string;
}

export interface DashboardProductionDay {
  fulfillmentDate: string;
  orderCount: number;
  products: Array<{
    productSpecId: string;
    productName: string;
    container: string;
    packages: number;
    batches: number;
    requiredProduct: { amount: string; unit: string };
    surplus: { amount: string; unit: string };
  }>;
  ingredients: Array<{ name: string; amount: string; unit: string }>;
  /** Why the plan couldn't be calculated, e.g. a missing recipe; null when it could. */
  problem: string | null;
}

export interface DashboardNotification {
  id: string;
  orderId: string;
  customerName: string;
  recipient: string;
  body: string;
  status: NotificationStatus;
  updatedAt: string;
}

export interface PreorderDashboard {
  stats: {
    openForms: number;
    awaitingReply: number;
    toFulfill: { count: number; packages: number; nextDate: string | null };
    /** Booked preorder totals with a fulfillment date in the month. */
    revenueMonth: MoneyAmount;
  };
  /** Upcoming forms by fulfillment date, then past forms newest first, then inactive ones. */
  forms: DashboardOrderForm[];
  /** Upcoming preorders by fulfillment date, then past preorders newest first. */
  preorders: DashboardPreorder[];
  /** Accepted preorders for the next few fulfillment dates, from each product's recipe. */
  production: DashboardProductionDay[];
  notifications: {
    counts: Record<NotificationStatus, number>;
    recent: DashboardNotification[];
  };
}

function formState(form: OrderFormRecord, today: string, now: Date): OrderFormState {
  if (!form.active) return "INACTIVE";
  if (form.fulfillmentDate < today) return "PAST";
  return form.closesAt.getTime() > now.getTime() ? "OPEN" : "CLOSED";
}

const formStateRank: Record<OrderFormState, number> = { OPEN: 0, CLOSED: 0, PAST: 1, INACTIVE: 2 };

function sumTotals(preorders: readonly PreorderRecord[]): MoneyAmount {
  return toMoneyAmount(preorders.reduce((total, order) => total + moneyToCents(order.total), 0));
}

function sumPackages(preorders: readonly PreorderRecord[]): number {
  return preorders.reduce(
    (total, order) => total + order.items.reduce((sum, item) => sum + item.quantity, 0),
    0
  );
}

function summarizeForm(
  form: OrderFormRecord,
  preorders: readonly PreorderRecord[],
  today: string,
  now: Date
): DashboardOrderForm {
  const onForm = preorders.filter((order) => order.formId === form.id);
  const holding = onForm.filter((order) => !releasedPreorderStatuses.includes(order.status));
  return {
    id: form.id,
    title: form.title,
    state: formState(form, today, now),
    fulfillmentDate: form.fulfillmentDate,
    closesAt: form.closesAt.toISOString(),
    fulfillmentMethod: form.fulfillmentMethod,
    fulfillmentInstructions: form.fulfillmentInstructions,
    minimumOrder: toMoneyAmount(moneyToCents(form.minimumOrder)),
    deliveryFee: toMoneyAmount(moneyToCents(form.deliveryFee)),
    products: form.products.map((product) => ({
      productSpecId: product.productSpecId,
      name: product.name,
      container: product.container,
      unitPrice: toMoneyAmount(moneyToCents(product.unitPrice)),
      maxPackages: product.maxPackages,
      reservedPackages: holding
        .flatMap((order) => order.items)
        .filter((item) => item.productSpecId === product.productSpecId)
        .reduce((total, item) => total + item.quantity, 0)
    })),
    preorderCount: onForm.length,
    awaitingReply: onForm.filter((order) => order.status === "REQUESTED").length,
    bookedTotal: sumTotals(onForm.filter((order) => bookedPreorderStatuses.includes(order.status)))
  };
}

function toDashboardPreorder(order: PreorderRecord, formTitles: Map<string, string>): DashboardPreorder {
  return {
    id: order.id,
    formId: order.formId,
    formTitle: formTitles.get(order.formId) ?? "Order form",
    customerName: order.customerName,
    fulfillmentDate: order.fulfillmentDate,
    deliveryAddress: order.deliveryAddress,
    status: order.status,
    lines: order.items.map((item) => {
      const unitPriceCents = moneyToCents(item.unitPrice);
      return {
        name: item.name,
        container: item.container,
        quantity: item.quantity,
        unitPrice: toMoneyAmount(unitPriceCents),
        lineTotal: toMoneyAmount(unitPriceCents * item.quantity)
      };
    }),
    total: toMoneyAmount(moneyToCents(order.total)),
    requestedOn: order.createdAt.toISOString().slice(0, 10)
  };
}

/** Plans one fulfillment date from its accepted preorders, like `productionPlan`. */
function planProductionDay(
  fulfillmentDate: string,
  accepted: readonly PreorderRecord[],
  specs: readonly ProductSpecRecord[]
): DashboardProductionDay {
  const empty = { fulfillmentDate, orderCount: accepted.length, products: [], ingredients: [] };
  const lines = new Map<string, ProductionLine>();
  for (const item of accepted.flatMap((order) => order.items)) {
    const definition = specs.find((spec) => spec.id === item.productSpecId);
    if (!definition) {
      return { ...empty, problem: `Recipe details are missing for ${item.name}.` };
    }
    const prior = lines.get(definition.id);
    lines.set(definition.id, {
      productSpecId: definition.id,
      productName: item.name,
      spec: definition.spec,
      packages: item.quantity + (prior?.packages ?? 0)
    });
  }

  try {
    const plan = calculateProduction([...lines.values()]);
    return {
      fulfillmentDate,
      orderCount: accepted.length,
      products: plan.products.map((product) => ({
        productSpecId: product.productSpecId,
        productName: product.productName,
        container: `${product.container} (${product.fill.amount} ${product.fill.unit})`,
        packages: product.packages,
        batches: product.batches,
        requiredProduct: product.requiredProduct,
        surplus: product.surplus
      })),
      ingredients: plan.ingredients,
      problem: null
    };
  } catch (error) {
    return {
      ...empty,
      problem: error instanceof Error ? error.message : "Check this product's recipe."
    };
  }
}

function summarizeProduction(
  preorders: readonly PreorderRecord[],
  specs: readonly ProductSpecRecord[],
  today: string
): DashboardProductionDay[] {
  const byDate = new Map<string, PreorderRecord[]>();
  for (const order of preorders) {
    if (order.status !== "ACCEPTED" || order.fulfillmentDate < today) continue;
    byDate.set(order.fulfillmentDate, [...(byDate.get(order.fulfillmentDate) ?? []), order]);
  }
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, productionDaysShown)
    .map(([date, accepted]) => planProductionDay(date, accepted, specs));
}

function summarizeNotifications(
  notifications: readonly NotificationDraftRecord[],
  preorders: readonly PreorderRecord[]
): PreorderDashboard["notifications"] {
  const counts = Object.fromEntries(
    notificationStatuses.map((status) => [status, 0])
  ) as Record<NotificationStatus, number>;
  const customerNames = new Map(preorders.map((order) => [order.id, order.customerName]));
  const recent: DashboardNotification[] = [];

  for (const notification of [...notifications].sort(
    (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()
  )) {
    const status = notificationStatuses.find((value) => value === notification.status);
    if (!status) continue;
    counts[status] += 1;
    if (recent.length < notificationsShown) {
      recent.push({
        id: notification.id,
        orderId: notification.orderId,
        customerName: customerNames.get(notification.orderId) ?? "Customer",
        recipient: notification.recipient,
        body: notification.body,
        status,
        updatedAt: notification.updatedAt.toISOString()
      });
    }
  }
  return { counts, recent };
}

/**
 * Summarizes one caterer's order forms, preorders, production, and customer
 * notifications. Records belonging to other caterers are ignored. Revenue is
 * the stored total of accepted and completed preorders, like catering orders.
 */
export function summarizePreorders(
  catererId: string,
  source: PreorderSource,
  today: string,
  month: { start: string; end: string }
): PreorderDashboard {
  const forms = source.forms.filter((form) => form.catererId === catererId);
  const preorders = source.preorders.filter((order) => order.catererId === catererId);
  const specs = source.productSpecs.filter((spec) => spec.catererId === catererId);
  const formTitles = new Map(forms.map((form) => [form.id, form.title]));

  const summarizedForms = forms
    .map((form) => summarizeForm(form, preorders, today, source.now))
    .sort((left, right) => {
      const rank = formStateRank[left.state] - formStateRank[right.state];
      if (rank !== 0) return rank;
      const byDate = left.fulfillmentDate.localeCompare(right.fulfillmentDate);
      return left.state === "PAST" || left.state === "INACTIVE" ? -byDate : byDate;
    });

  const isUpcoming = (order: PreorderRecord) => order.fulfillmentDate >= today;
  const sortedPreorders = [
    ...preorders.filter(isUpcoming).sort((left, right) =>
      left.fulfillmentDate.localeCompare(right.fulfillmentDate) ||
      left.createdAt.getTime() - right.createdAt.getTime()
    ),
    ...preorders.filter((order) => !isUpcoming(order)).sort((left, right) =>
      right.fulfillmentDate.localeCompare(left.fulfillmentDate) ||
      right.createdAt.getTime() - left.createdAt.getTime()
    )
  ];

  const toFulfill = preorders.filter((order) => order.status === "ACCEPTED" && isUpcoming(order));
  const nextDate = toFulfill.map((order) => order.fulfillmentDate).sort()[0] ?? null;

  return {
    stats: {
      openForms: summarizedForms.filter((form) => form.state === "OPEN").length,
      awaitingReply: preorders.filter((order) => order.status === "REQUESTED").length,
      toFulfill: { count: toFulfill.length, packages: sumPackages(toFulfill), nextDate },
      revenueMonth: sumTotals(preorders.filter((order) =>
        bookedPreorderStatuses.includes(order.status) &&
        order.fulfillmentDate >= month.start &&
        order.fulfillmentDate <= month.end
      ))
    },
    forms: summarizedForms,
    preorders: sortedPreorders.map((order) => toDashboardPreorder(order, formTitles)),
    production: summarizeProduction(preorders, specs, today),
    notifications: summarizeNotifications(
      source.notifications.filter((notification) => notification.catererId === catererId),
      preorders
    )
  };
}
