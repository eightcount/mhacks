import { inArray } from "drizzle-orm";
import type { db } from "./index.js";
import {
  availability,
  catererNotificationDrafts,
  catererOrderForms,
  catererPreorders,
  catererProductSpecs,
  caterers,
  menuItems,
  orderItems,
  orders,
  users
} from "./schema/index.js";
import type { Availability, Caterer, OrderStatus } from "../types/domain.js";
import type { FormProduct, PreorderItem } from "../types/caterer-operations.js";
import { assessAvailability } from "../services/matching.js";
import { calculateOrderTotal, centsToMoney, moneyToCents } from "../services/money.js";
import { assertOrderTransition } from "../services/order-state.js";
import { validateProductSpec } from "../services/production-math.js";
import { offsetSeedDate } from "./seed-data.js";
import {
  buildVarietyOperations,
  buildVarietyOrderPlans,
  catererVarieties,
  orderTimeline,
  varietyCustomers,
  varietyMenuItems,
  varietyProductSpecs,
  type VarietyOrderPlan
} from "./seed-variety-data.js";

type SeedTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** How far an event date may move to avoid a closed or already-booked date. */
const maximumDateShift = 10;

const releasedStatuses: readonly OrderStatus[] = ["DECLINED", "CANCELLED"];

/** Fictional fixtures skip the API, so check that their simulated lifecycle is legal. */
function assertFixtureLifecycle(status: OrderStatus): void {
  if (status === "DRAFT") return;
  assertOrderTransition("DRAFT", "REQUESTED");
  if (status === "COMPLETED") {
    assertOrderTransition("REQUESTED", "ACCEPTED");
    assertOrderTransition("ACCEPTED", "COMPLETED");
  } else if (status !== "REQUESTED") {
    assertOrderTransition("REQUESTED", status);
  }
}

function containerLabel(spec: { container: { name: string; fill: { amount: string; unit: string } } }): string {
  return `${spec.container.name} (${spec.container.fill.amount} ${spec.container.fill.unit})`;
}

/**
 * Picks the planned event date, or the nearest date in the same direction
 * (later for upcoming events, earlier for past ones) that is not closed, has
 * room for the guests, and has no other order from this caterer.
 */
function resolveEventDate(
  plan: VarietyOrderPlan,
  profile: Caterer,
  calendar: ReadonlyMap<string, Availability>,
  bookedDates: ReadonlySet<string>,
  referenceDate: string
): string {
  const direction = plan.eventDate >= referenceDate ? 1 : -1;
  for (let shift = 0; shift <= maximumDateShift; shift += 1) {
    const date = offsetSeedDate(plan.eventDate, direction * shift);
    if (direction === 1 ? date <= referenceDate : date >= referenceDate) continue;
    const key = `${profile.id}:${date}`;
    if (bookedDates.has(key)) continue;
    const entry = calendar.get(key);
    if (entry && !assessAvailability(profile, entry, plan.guestCount).available) continue;
    return date;
  }
  throw new Error("A fictional variety order has no open date nearby.");
}

async function seedVarietyOrders(
  tx: SeedTransaction,
  referenceDate: string,
  profiles: readonly Caterer[],
  storedMenu: ReadonlyArray<typeof menuItems.$inferSelect>
): Promise<number> {
  const catererIds = profiles.map((profile) => profile.id);
  const plans = buildVarietyOrderPlans(referenceDate);
  const [storedOrders, storedAvailability] = await Promise.all([
    tx.select({ id: orders.id, catererId: orders.catererId, eventDate: orders.eventDate, status: orders.status })
      .from(orders).where(inArray(orders.catererId, catererIds)),
    tx.select().from(availability).where(inArray(availability.catererId, catererIds))
  ]);
  const existingIds = new Set(storedOrders.map((order) => order.id));
  const bookedDates = new Set(storedOrders
    .filter((order) => order.status !== "DRAFT")
    .map((order) => `${order.catererId}:${order.eventDate}`));
  const calendar = new Map(storedAvailability.map((entry) => [`${entry.catererId}:${entry.date}`, entry]));

  const newAvailability: Array<typeof availability.$inferInsert> = [];
  const newOrders: Array<typeof orders.$inferInsert> = [];
  const newItems: Array<typeof orderItems.$inferInsert> = [];

  for (const plan of plans) {
    if (existingIds.has(plan.id)) continue;
    const profile = profiles.find((entry) => entry.id === plan.catererId);
    if (!profile?.active) throw new Error("Variety orders require an active fictional caterer.");
    if (!profile.supportedEventStyles.includes(plan.eventStyle)) {
      throw new Error("A fictional variety order uses an unsupported event style.");
    }
    if (profile.fulfillmentMethod !== "EITHER" && profile.fulfillmentMethod !== plan.fulfillmentMethod) {
      throw new Error("A fictional variety order uses an unsupported fulfillment method.");
    }
    assertFixtureLifecycle(plan.status);

    const eventDate = resolveEventDate(plan, profile, calendar, bookedDates, referenceDate);
    const key = `${profile.id}:${eventDate}`;
    if (!calendar.has(key)) {
      if (plan.guestCount > profile.maximumCapacity) throw new Error("A fictional order exceeds capacity.");
      const entry = {
        catererId: profile.id,
        date: eventDate,
        available: true,
        capacityOverride: profile.maximumCapacity
      };
      newAvailability.push(entry);
      calendar.set(key, { ...entry, id: "", createdAt: new Date(), updatedAt: new Date() });
    }
    if (plan.status !== "DRAFT") bookedDates.add(key);

    const selections = plan.lines.map((line) => {
      const item = storedMenu.find((entry) => entry.id === line.menuItemId);
      if (!item || item.catererId !== plan.catererId) {
        throw new Error("Variety orders may only contain the caterer's own menu items.");
      }
      if (!item.active && plan.status !== "COMPLETED") {
        throw new Error("Only completed fictional orders may include a now-inactive menu item.");
      }
      if (!plan.dietaryRestrictions.every((tag) => item.dietaryTags.includes(tag))) {
        throw new Error("A fictional order item does not meet the order's dietary restrictions.");
      }
      return { menuItemId: item.id, unitPrice: item.price, quantity: line.quantity };
    });

    // Meet the caterer's minimum the way a customer would: add servings of the main item.
    const isDelivery = plan.fulfillmentMethod === "DELIVERY";
    const minimum = Math.max(
      moneyToCents(profile.minimumOrder),
      isDelivery && profile.minimumDeliveryOrder ? moneyToCents(profile.minimumDeliveryOrder) : 0
    );
    const shortfall = minimum - calculateOrderTotal(selections).cents;
    if (shortfall > 0) {
      const main = selections[0]!;
      main.quantity += Math.ceil(shortfall / moneyToCents(main.unitPrice));
    }
    const totalCents = calculateOrderTotal(selections).cents +
      (isDelivery && profile.deliveryFee ? moneyToCents(profile.deliveryFee) : 0);
    const { createdAt, updatedAt } = orderTimeline(eventDate, plan.status, referenceDate, plan.leadDays);

    newOrders.push({
      id: plan.id,
      customerId: plan.customerId,
      catererId: plan.catererId,
      eventDate,
      guestCount: plan.guestCount,
      budget: centsToMoney(totalCents + plan.budgetHeadroomCents),
      estimatedTotal: centsToMoney(totalCents),
      requestedDishes: plan.lines.map((line) => storedMenu.find((item) => item.id === line.menuItemId)!.name),
      requestedCuisines: profile.cuisineTypes,
      eventStyle: plan.eventStyle,
      dietaryRestrictions: plan.dietaryRestrictions,
      eventLocation: plan.eventLocation,
      fulfillmentMethod: plan.fulfillmentMethod,
      status: plan.status,
      specialRequests: plan.specialRequests,
      createdAt,
      updatedAt
    });
    newItems.push(...selections.map((selection) => ({
      orderId: plan.id,
      menuItemId: selection.menuItemId,
      quantity: selection.quantity,
      unitPrice: selection.unitPrice,
      createdAt
    })));
  }

  if (newAvailability.length > 0) {
    await tx.insert(availability).values(newAvailability)
      .onConflictDoNothing({ target: [availability.catererId, availability.date] });
  }
  if (newOrders.length === 0) return 0;
  const created = await tx.insert(orders).values(newOrders)
    .onConflictDoNothing({ target: orders.id }).returning({ id: orders.id });
  const createdIds = new Set(created.map((order) => order.id));
  const items = newItems.filter((item) => createdIds.has(item.orderId));
  if (items.length > 0) {
    await tx.insert(orderItems).values(items)
      .onConflictDoNothing({ target: [orderItems.orderId, orderItems.menuItemId] });
  }
  return created.length;
}

async function seedVarietyOperations(
  tx: SeedTransaction,
  referenceDate: string,
  profiles: readonly Caterer[],
  storedMenu: ReadonlyArray<typeof menuItems.$inferSelect>
): Promise<{ productSpecs: number; forms: number; preorders: number; notifications: number }> {
  // Recipe revisions: a new revision of an item supersedes older ones on the menu.
  const specRows = varietyProductSpecs.map((entry) => {
    const item = storedMenu.find((menuItem) => menuItem.id === entry.spec.menuItemId);
    if (!item || item.catererId !== entry.catererId || !item.active) {
      throw new Error("Product definitions must belong to an active item of the same caterer.");
    }
    return {
      id: entry.id,
      catererId: entry.catererId,
      menuItemId: item.id,
      productName: item.name,
      spec: validateProductSpec(entry.spec)
    };
  });
  const insertedSpecs = await tx.insert(catererProductSpecs).values(specRows)
    .onConflictDoNothing({ target: catererProductSpecs.id }).returning({ id: catererProductSpecs.id });
  const storedSpecs = await tx.select().from(catererProductSpecs)
    .where(inArray(catererProductSpecs.id, specRows.map((row) => row.id)));

  const operations = buildVarietyOperations(referenceDate);
  const formRows = operations.forms.map((form) => {
    const profile = profiles.find((entry) => entry.id === form.catererId);
    if (!profile?.active) throw new Error("Order forms require an active fictional caterer.");
    if (profile.fulfillmentMethod !== "EITHER" && profile.fulfillmentMethod !== form.fulfillmentMethod) {
      throw new Error("A fictional order form uses an unsupported fulfillment method.");
    }
    if (form.closesAt.toISOString().slice(0, 10) > form.fulfillmentDate) {
      throw new Error("A fictional order form closes after its fulfillment date.");
    }
    const products: FormProduct[] = form.products.map((selection) => {
      const spec = storedSpecs.find((entry) => entry.id === selection.productSpecId);
      const item = spec && storedMenu.find((entry) => entry.id === spec.menuItemId);
      if (!spec || spec.catererId !== form.catererId || !item?.active) {
        throw new Error("Every order form product must be an active item owned by the caterer.");
      }
      return {
        productSpecId: spec.id,
        name: spec.productName,
        unitPrice: item.price,
        container: containerLabel(spec.spec),
        maxPackages: selection.maxPackages
      };
    });
    return {
      id: form.id,
      catererId: form.catererId,
      title: form.title,
      fulfillmentDate: form.fulfillmentDate,
      closesAt: form.closesAt,
      fulfillmentMethod: form.fulfillmentMethod,
      fulfillmentInstructions: form.fulfillmentInstructions,
      minimumOrder: form.minimumOrder,
      deliveryFee: form.fulfillmentMethod === "DELIVERY" ? form.deliveryFee : "0.00",
      products,
      active: form.active,
      createdAt: form.createdAt,
      updatedAt: form.createdAt
    };
  });
  const insertedForms = await tx.insert(catererOrderForms).values(formRows)
    .onConflictDoNothing({ target: catererOrderForms.id }).returning({ id: catererOrderForms.id });
  const formIds = formRows.map((form) => form.id);
  const [storedForms, storedPreorders] = await Promise.all([
    tx.select().from(catererOrderForms).where(inArray(catererOrderForms.id, formIds)),
    tx.select().from(catererPreorders).where(inArray(catererPreorders.formId, formIds))
  ]);

  // Package reservations follow submitPreorder: declined and cancelled preorders release theirs.
  const reserved = new Map<string, number>();
  const reserve = (formId: string, productSpecId: string, quantity: number) =>
    reserved.set(`${formId}:${productSpecId}`, (reserved.get(`${formId}:${productSpecId}`) ?? 0) + quantity);
  for (const order of storedPreorders) {
    if (releasedStatuses.includes(order.status)) continue;
    for (const item of order.items) reserve(order.formId, item.productSpecId, item.quantity);
  }

  const existingPreorderIds = new Set(storedPreorders.map((order) => order.id));
  const preorderRows = operations.preorders.filter((order) => !existingPreorderIds.has(order.id)).map((order) => {
    const form = storedForms.find((entry) => entry.id === order.formId);
    if (!form || form.catererId !== order.catererId) throw new Error("A fictional preorder has no matching form.");
    if (order.createdAt.getTime() >= form.closesAt.getTime()) {
      throw new Error("A fictional preorder was submitted after its form closed.");
    }
    if (form.fulfillmentMethod === "DELIVERY" && !order.deliveryAddress) {
      throw new Error("A fictional delivery preorder needs an address.");
    }
    if (order.status === "COMPLETED" && form.fulfillmentDate >= referenceDate) {
      throw new Error("Only past fictional preorders can be completed.");
    }
    assertFixtureLifecycle(order.status);
    const items: PreorderItem[] = order.items.map((selection) => {
      const product = form.products.find((entry) => entry.productSpecId === selection.productSpecId);
      if (!product) throw new Error("A fictional preorder item is not offered on its form.");
      if (!releasedStatuses.includes(order.status)) {
        const held = reserved.get(`${form.id}:${product.productSpecId}`) ?? 0;
        if (held + selection.quantity > product.maxPackages) {
          throw new Error(`${product.name} does not have enough fictional packages remaining.`);
        }
        reserve(form.id, product.productSpecId, selection.quantity);
      }
      return {
        productSpecId: product.productSpecId,
        name: product.name,
        container: product.container,
        unitPrice: product.unitPrice,
        quantity: selection.quantity
      };
    });
    const subtotal = calculateOrderTotal(items);
    if (subtotal.cents < moneyToCents(form.minimumOrder)) {
      throw new Error("A fictional preorder is below its form's minimum.");
    }
    return {
      id: order.id,
      formId: form.id,
      catererId: form.catererId,
      submissionId: order.submissionId,
      customerName: order.customerName,
      customerContact: order.customerContact,
      deliveryAddress: order.deliveryAddress,
      fulfillmentDate: form.fulfillmentDate,
      items,
      total: centsToMoney(subtotal.cents + moneyToCents(form.deliveryFee)),
      status: order.status,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt
    };
  });
  const insertedPreorders = preorderRows.length === 0 ? [] : await tx.insert(catererPreorders)
    .values(preorderRows).onConflictDoNothing().returning({ id: catererPreorders.id });

  const notificationIds = operations.notifications.map((notification) => notification.id);
  const [linkedPreorders, existingNotifications] = await Promise.all([
    tx.select().from(catererPreorders)
      .where(inArray(catererPreorders.id, operations.notifications.map((entry) => entry.orderId))),
    tx.select({ id: catererNotificationDrafts.id }).from(catererNotificationDrafts)
      .where(inArray(catererNotificationDrafts.id, notificationIds))
  ]);
  const existingNotificationIds = new Set(existingNotifications.map((entry) => entry.id));
  const notificationRows = operations.notifications
    .filter((notification) => !existingNotificationIds.has(notification.id))
    .map((notification) => {
      const order = linkedPreorders.find((entry) => entry.id === notification.orderId);
      const business = profiles.find((entry) => entry.id === notification.catererId);
      if (!order || !business || order.catererId !== business.id ||
        !["ACCEPTED", "COMPLETED"].includes(order.status)) {
        throw new Error("Notifications require an accepted or completed preorder of the same caterer.");
      }
      // Same wording as draftNotifications.
      return {
        id: notification.id,
        catererId: business.id,
        orderId: order.id,
        recipient: order.customerContact,
        body: `Hi ${order.customerName}, your order from ${business.businessName} is scheduled for ${order.fulfillmentDate}, ${notification.deliveryWindow}. ${notification.note}`.trim(),
        status: notification.status,
        createdAt: notification.updatedAt,
        updatedAt: notification.updatedAt
      };
    });
  const insertedNotifications = notificationRows.length === 0 ? [] : await tx
    .insert(catererNotificationDrafts).values(notificationRows)
    .onConflictDoNothing({ target: catererNotificationDrafts.id })
    .returning({ id: catererNotificationDrafts.id });

  return {
    productSpecs: insertedSpecs.length,
    forms: insertedForms.length,
    preorders: insertedPreorders.length,
    notifications: insertedNotifications.length
  };
}

/**
 * Adds varied fictional customers, menu items, six months of catering orders,
 * and preorder operations for the four active fictional caterers. Stable IDs
 * and conflict handling keep repeat runs additive: existing rows, including
 * status changes made through the app, are never overwritten.
 */
export async function seedVarietyFixtures(tx: SeedTransaction, referenceDate: string) {
  await tx.insert(users).values(varietyCustomers).onConflictDoNothing({ target: users.id });
  await tx.insert(menuItems).values(varietyMenuItems).onConflictDoNothing({ target: menuItems.id });

  const catererIds = catererVarieties.map((variety) => variety.catererId);
  const [profiles, storedMenu] = await Promise.all([
    tx.select().from(caterers).where(inArray(caterers.id, catererIds)),
    tx.select().from(menuItems).where(inArray(menuItems.catererId, catererIds))
  ]);

  const orderCount = await seedVarietyOrders(tx, referenceDate, profiles, storedMenu);
  const operationCounts = await seedVarietyOperations(tx, referenceDate, profiles, storedMenu);
  return { orders: orderCount, ...operationCounts };
}
