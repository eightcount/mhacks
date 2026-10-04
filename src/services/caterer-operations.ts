import { and, desc, eq, gte, inArray, lte, notInArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { caterers, catererProductSpecs, catererOrderForms, catererPreorders, catererNotificationDrafts, menuItems } from "../db/schema/index.js";
import { batchStatusChangeSchema, formSchema, notificationRecipientSchema, notificationSchema, periodSchema, preorderSchema, productionSelectionSchema, statusChangeSchema } from "../validation/caterer-operations.js";
import { getCaterer } from "./caterers.js";
import { assertCatererOwnership } from "./authorization.js";
import { calculateOrderTotal, centsToMoney, moneyToCents } from "./money.js";
import { assertOrderTransition } from "./order-state.js";
import { calculateProduction, validateProductSpec, type ProductionLine } from "./production-math.js";

export interface CatererActor { catererId: string; actorUserId: string }
export class CatererOperationError extends Error {}
export async function authorizeCaterer(actor: CatererActor) {
  const caterer = await getCaterer(actor.catererId);
  assertCatererOwnership(caterer, actor.actorUserId);
  return caterer;
}
export async function getOrderFormOptions(actor: CatererActor): Promise<{supportedFulfillmentMethods: Array<"PICKUP" | "DELIVERY">}> {
  const caterer = await authorizeCaterer(actor);
  return {supportedFulfillmentMethods: caterer.fulfillmentMethod === "EITHER"
    ? ["PICKUP", "DELIVERY"] : [caterer.fulfillmentMethod]};
}
export async function saveProductSpec(actor: CatererActor, input: unknown) {
  await authorizeCaterer(actor);
  let spec;
  try { spec = validateProductSpec(input); }
  catch (error) { throw new CatererOperationError(error instanceof Error ? error.message : "Check the recipe measurements."); }
  const [item] = await db.select().from(menuItems).where(and(eq(menuItems.id, spec.menuItemId), eq(menuItems.catererId, actor.catererId), eq(menuItems.active, true)));
  if (!item) throw new CatererOperationError("Choose an active menu item belonging to this caterer.");
  const [saved] = await db.insert(catererProductSpecs).values({catererId: actor.catererId, menuItemId: item.id, productName: item.name, spec}).returning();
  return saved;
}
export async function listProductSpecs(actor: CatererActor) {
  await authorizeCaterer(actor);
  return db.select().from(catererProductSpecs).where(eq(catererProductSpecs.catererId, actor.catererId)).orderBy(desc(catererProductSpecs.createdAt));
}
export async function previewOrderForm(actor: CatererActor, input: unknown) {
  const caterer = await authorizeCaterer(actor), parsed = formSchema.parse(input);
  if (!caterer.active) throw new CatererOperationError("Activate the caterer before opening an order form.");
  if (caterer.fulfillmentMethod !== "EITHER" && caterer.fulfillmentMethod !== parsed.fulfillmentMethod) {
    throw new CatererOperationError(`This caterer does not support ${parsed.fulfillmentMethod.toLowerCase()}. Choose ${caterer.fulfillmentMethod.toLowerCase()} for this form.`);
  }
  const closesAt = new Date(parsed.closesAt);
  if (closesAt.getTime() <= Date.now() || parsed.closesAt.slice(0, 10) > parsed.fulfillmentDate) throw new CatererOperationError("The closing time must be in the future and no later than the fulfillment date in its supplied time zone.");
  const definitions = await db.select({definition: catererProductSpecs, price: menuItems.price, active: menuItems.active})
    .from(catererProductSpecs).innerJoin(menuItems, eq(menuItems.id, catererProductSpecs.menuItemId))
    .where(and(eq(catererProductSpecs.catererId, actor.catererId), inArray(catererProductSpecs.id, parsed.products.map(p => p.productSpecId))));
  const products = parsed.products.map(selection => {
    const row = definitions.find(row => row.definition.id === selection.productSpecId);
    if (!row || !row.active) throw new CatererOperationError("Every product must be an active item owned by this caterer.");
    if (selection.expectedUnitPrice !== undefined && moneyToCents(selection.expectedUnitPrice) !== moneyToCents(row.price)) {
      throw new CatererOperationError("A menu price changed. Review the form again before publishing.");
    }
    return {productSpecId: selection.productSpecId, maxPackages: selection.maxPackages, name: row.definition.productName, unitPrice: row.price,
      container: `${row.definition.spec.container.name} (${row.definition.spec.container.fill.amount} ${row.definition.spec.container.fill.unit})`};
  });
  return {catererId: actor.catererId, title: parsed.title,
    fulfillmentDate: parsed.fulfillmentDate, closesAt, fulfillmentMethod: parsed.fulfillmentMethod,
    fulfillmentInstructions: parsed.fulfillmentInstructions, minimumOrder: parsed.minimumOrder,
    deliveryFee: parsed.fulfillmentMethod === "DELIVERY" ? parsed.deliveryFee : "0.00", products};
}
export async function createOrderForm(actor: CatererActor, input: unknown) {
  const prepared = await previewOrderForm(actor, input);
  const [form] = await db.insert(catererOrderForms).values(prepared).returning();
  return form;
}
export async function getPublicForm(formId: string) {
  const [form] = await db.select().from(catererOrderForms).where(eq(catererOrderForms.id, formId));
  if (!form) throw new CatererOperationError("Order form not found.");
  const caterer = await getCaterer(form.catererId);
  return {id: form.id, title: form.title, businessName: caterer.businessName, products: form.products,
    minimumOrder: form.minimumOrder, deliveryFee: form.deliveryFee, fulfillmentDate: form.fulfillmentDate,
    fulfillmentMethod: form.fulfillmentMethod, fulfillmentInstructions: form.fulfillmentInstructions,
    closesAt: form.closesAt, open: form.active && caterer.active && form.closesAt.getTime() > Date.now()};
}
export async function submitPreorder(formId: string, input: unknown) {
  const parsed = preorderSchema.parse(input);
  return db.transaction(async tx => {
    // Serialize reservations on a form; retries use the same submission ID.
    const [form] = await tx.select().from(catererOrderForms).where(eq(catererOrderForms.id, formId)).for("update");
    if (!form) throw new CatererOperationError("Order form not found.");
    const [prior] = await tx.select().from(catererPreorders).where(and(eq(catererPreorders.formId, form.id), eq(catererPreorders.submissionId, parsed.submissionId)));
    if (prior) return {orderId: prior.id, status: prior.status, total: prior.total};
    const [business] = await tx.select({active: caterers.active}).from(caterers).where(eq(caterers.id, form.catererId));
    if (!business?.active) throw new CatererOperationError("This caterer is not taking orders.");
    if (!form.active || form.closesAt.getTime() <= Date.now()) throw new CatererOperationError("This order form is closed.");
    if (form.fulfillmentMethod === "DELIVERY" && !parsed.deliveryAddress) throw new CatererOperationError("A delivery address is required.");
    const reservations = await tx.select({items: catererPreorders.items}).from(catererPreorders)
      .where(and(eq(catererPreorders.formId, form.id), notInArray(catererPreorders.status, ["DECLINED", "CANCELLED"])));
    const items = parsed.items.map(selection => {
      const product = form.products.find(p => p.productSpecId === selection.productSpecId);
      if (!product) throw new CatererOperationError("That item is not offered on this form.");
      const reserved = reservations.flatMap(r => r.items).filter(i => i.productSpecId === selection.productSpecId).reduce((total, i) => total + i.quantity, 0);
      if (reserved + selection.quantity > product.maxPackages) throw new CatererOperationError(`${product.name} does not have enough packages remaining.`);
      return {productSpecId: product.productSpecId, name: product.name, container: product.container, unitPrice: product.unitPrice, quantity: selection.quantity};
    });
    const subtotal = calculateOrderTotal(items);
    if (subtotal.cents < moneyToCents(form.minimumOrder)) throw new CatererOperationError(`The food subtotal must be at least $${form.minimumOrder}.`);
    const total = centsToMoney(subtotal.cents + moneyToCents(form.deliveryFee));
    if (moneyToCents(total) > 999_999_999_999) throw new CatererOperationError("Order total is too large.");
    const [order] = await tx.insert(catererPreorders).values({formId: form.id, catererId: form.catererId,
      submissionId: parsed.submissionId, customerName: parsed.customerName, customerContact: parsed.customerContact,
      deliveryAddress: parsed.deliveryAddress, fulfillmentDate: form.fulfillmentDate, items, total, status: "REQUESTED"}).returning();
    if (!order) throw new CatererOperationError("Order could not be saved.");
    return {orderId: order.id, status: order.status, total: order.total};
  });
}
export async function listPreorders(actor: CatererActor, input: unknown) {
  await authorizeCaterer(actor);
  const period = periodSchema.parse(input);
  return db.select().from(catererPreorders).where(and(eq(catererPreorders.catererId, actor.catererId),
    gte(catererPreorders.fulfillmentDate, period.start), lte(catererPreorders.fulfillmentDate, period.end))).orderBy(catererPreorders.fulfillmentDate, catererPreorders.createdAt);
}
export async function changePreorderStatus(actor: CatererActor, input: unknown) {
  await authorizeCaterer(actor);
  const parsed = statusChangeSchema.parse(input);
  return db.transaction(async tx => {
    const [order] = await tx.select().from(catererPreorders).where(and(eq(catererPreorders.id, parsed.orderId), eq(catererPreorders.catererId, actor.catererId))).for("update");
    if (!order) throw new CatererOperationError("Order not found for this caterer.");
    assertOrderTransition(order.status, parsed.status);
    const [updated] = await tx.update(catererPreorders).set({status: parsed.status, updatedAt: new Date()}).where(eq(catererPreorders.id, order.id)).returning();
    return updated;
  });
}
/** Validate the entire selection under row locks before changing any order. */
export async function changePreorderStatuses(actor: CatererActor, input: unknown) {
  await authorizeCaterer(actor);
  const parsed = batchStatusChangeSchema.parse(input);
  return db.transaction(async tx => {
    const owned = and(eq(catererPreorders.catererId, actor.catererId), inArray(catererPreorders.id, parsed.orderIds));
    const orders = await tx.select().from(catererPreorders).where(owned).orderBy(catererPreorders.id).for("update");
    if (orders.length !== parsed.orderIds.length) throw new CatererOperationError("Every selected order must belong to this caterer. No orders changed.");
    for (const order of orders) assertOrderTransition(order.status, parsed.status);
    return tx.update(catererPreorders).set({status: parsed.status, updatedAt: new Date()}).where(owned).returning();
  });
}
export async function productionPlan(actor: CatererActor, input: unknown) {
  const selection = productionSelectionSchema.parse(input);
  let orders: Awaited<ReturnType<typeof listPreorders>>;
  if ("orderId" in selection) {
    await authorizeCaterer(actor);
    const [order] = await db.select().from(catererPreorders).where(and(
      eq(catererPreorders.id, selection.orderId), eq(catererPreorders.catererId, actor.catererId)));
    if (!order) throw new CatererOperationError("Order not found for this caterer.");
    if (order.status !== "ACCEPTED") throw new CatererOperationError("This order must be accepted before planning or shopping for its ingredients.");
    orders = [order];
  } else {
    orders = await listPreorders(actor, selection);
  }
  const dates = "orderId" in selection
    ? {start: orders[0]!.fulfillmentDate, end: orders[0]!.fulfillmentDate} : selection;
  const accepted = orders.filter(order => order.status === "ACCEPTED");
  const ids = [...new Set(accepted.flatMap(order => order.items.map(item => item.productSpecId)))];
  const specs = ids.length ? await db.select().from(catererProductSpecs).where(and(eq(catererProductSpecs.catererId, actor.catererId), inArray(catererProductSpecs.id, ids))) : [];
  const grouped = new Map<string, ProductionLine>();
  for (const item of accepted.flatMap(order => order.items)) {
    const definition = specs.find(spec => spec.id === item.productSpecId);
    if (!definition) throw new CatererOperationError("An ordered product is missing its recipe/container definition.");
    const prior = grouped.get(definition.id);
    grouped.set(definition.id, {productSpecId: definition.id, productName: item.name, spec: definition.spec, packages: item.quantity + (prior?.packages ?? 0)});
  }
  return {...calculateProduction([...grouped.values()]), acceptedOrders: accepted.length,
    pendingRequests: orders.filter(order => order.status === "REQUESTED").length, period: dates,
    ...("orderId" in selection ? {orderId: selection.orderId} : {}),
    scope: "orderId" in selection ? "One accepted order from a caterer order form" : "Accepted orders from caterer order forms"};
}
export async function draftNotifications(actor: CatererActor, input: unknown) {
  const caterer = await authorizeCaterer(actor), parsed = notificationSchema.parse(input);
  const ids = [...new Set(parsed.orderIds)];
  const orders = await db.select().from(catererPreorders).where(and(eq(catererPreorders.catererId, actor.catererId), inArray(catererPreorders.id, ids)));
  if (orders.length !== ids.length || orders.some(order => !["ACCEPTED", "COMPLETED"].includes(order.status))) throw new CatererOperationError("Notifications require accepted or completed orders belonging to this caterer.");
  return db.insert(catererNotificationDrafts).values(orders.map(order => ({catererId: actor.catererId, orderId: order.id,
    recipient: order.customerContact, body: `Hi ${order.customerName}, your order from ${caterer.businessName} is scheduled for ${order.fulfillmentDate}, ${parsed.deliveryWindow}. ${parsed.note}`.trim(), status: "DRAFT"}))).returning();
}

/** Change only an owned, unsent draft; the customer's order contact is untouched. */
export async function updateNotificationRecipient(actor: CatererActor, input: unknown) {
  const parsed = notificationRecipientSchema.parse(input);
  await authorizeCaterer(actor);
  // Atomic with the send claim: a draft already being sent cannot be redirected.
  const [draft] = await db.update(catererNotificationDrafts)
    .set({recipient: parsed.recipient, updatedAt: new Date()})
    .where(and(eq(catererNotificationDrafts.id, parsed.notificationId),
      eq(catererNotificationDrafts.catererId, actor.catererId), eq(catererNotificationDrafts.status, "DRAFT")))
    .returning();
  if (!draft) throw new CatererOperationError("Only your unsent notification drafts can be edited. Create a new draft with 'notify'.");
  return draft;
}
