import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { catererPreorders, catererProductSpecs } from "../db/schema/index.js";
import { daySchema, orderReceiptSchema, periodSchema } from "../validation/caterer-operations.js";
import { authorizeCaterer, CatererOperationError, listPreorders, type CatererActor } from "./caterer-operations.js";
import { calculateOrderTotal, centsToMoney, moneyToCents } from "./money.js";

import { documentHtml, escapeHtml } from "./document-html.js";
export { documentHtml, escapeHtml } from "./document-html.js";

/** Read historical order prices without changing the order or implying payment. */
export async function createOrderReceipt(actor: CatererActor, input: unknown) {
  const {orderId} = orderReceiptSchema.parse(input);
  const caterer = await authorizeCaterer(actor);
  const [order] = await db.select().from(catererPreorders)
    .where(and(eq(catererPreorders.id, orderId), eq(catererPreorders.catererId, actor.catererId)));
  if (!order) throw new CatererOperationError("Order not found for this caterer.");

  const subtotal = calculateOrderTotal(order.items);
  const totalCents = moneyToCents(order.total);
  // Delivery is the only charge beyond items in submitPreorder. Recover its
  // historical amount from the saved total, never the current form or menu.
  if (totalCents < subtotal.cents) throw new CatererOperationError("The saved order total does not match its items. Check the order before requesting a receipt.");
  const deliveryFee = centsToMoney(totalCents - subtotal.cents);
  const total = centsToMoney(totalCents);
  const items = order.items.map(item => ({...item,
    unitPrice: centsToMoney(moneyToCents(item.unitPrice)),
    lineTotal: centsToMoney(moneyToCents(item.unitPrice) * item.quantity)}));
  const details = [`Order: ${order.id}`, `Customer: ${order.customerName}`,
    `Fulfillment date: ${order.fulfillmentDate}`, `Order status: ${order.status}`];
  const totals = [`Subtotal: $${subtotal.amount}`, `Delivery fee: $${deliveryFee}`, `Total: $${total}`];
  const payment = "Payment is not recorded by this app. This receipt summarizes the order and does not confirm payment.";
  const text = ["Order receipt", caterer.businessName, ...details, "",
    ...items.map(item => `${item.quantity} × ${item.name} — ${item.container} — $${item.unitPrice} each = $${item.lineTotal}`),
    "", ...totals, "", payment].join("\n");
  const html = documentHtml("Order receipt", `<h1>Order receipt</h1><h2>${escapeHtml(caterer.businessName)}</h2>
    ${details.map(line => `<p>${escapeHtml(line)}</p>`).join("")}
    <table class="receipt-items"><thead><tr><th scope="col">Item / container</th><th scope="col">Qty</th><th scope="col">Unit price</th><th scope="col">Amount</th></tr></thead>
    <tbody>${items.map(item => `<tr><td>${escapeHtml(item.name)}<small>${escapeHtml(item.container)}</small></td><td>${item.quantity}</td><td>$${item.unitPrice}</td><td>$${item.lineTotal}</td></tr>`).join("")}</tbody></table>
    ${totals.map(line => `<p><strong>${escapeHtml(line)}</strong></p>`).join("")}
    <p>${escapeHtml(payment)}</p><p class="no-print">Print this page to paper or save it as PDF.</p>`);
  return {orderId: order.id, text, html, documentKind: "receipt" as const};
}

export async function createLabels(actor: CatererActor, input: unknown) {
  const parsed = z.object({start: daySchema, end: daySchema, preparedOn: daySchema.optional(), useBy: daySchema.optional()}).strict().parse(input);
  periodSchema.parse({start: parsed.start, end: parsed.end});
  if (parsed.preparedOn && parsed.useBy && parsed.useBy < parsed.preparedOn) throw new CatererOperationError("Use-by date cannot precede preparation date.");
  const caterer = await authorizeCaterer(actor);
  const orders = (await listPreorders(actor, {start: parsed.start, end: parsed.end})).filter(order => ["ACCEPTED", "COMPLETED"].includes(order.status));
  const ids = [...new Set(orders.flatMap(order => order.items.map(i => i.productSpecId)))];
  const specs = ids.length ? await db.select().from(catererProductSpecs).where(and(eq(catererProductSpecs.catererId, actor.catererId), inArray(catererProductSpecs.id, ids))) : [];
  let count = 0;
  const labels: string[] = [];
  for (const order of orders) for (const item of order.items) {
    const spec = specs.find(spec => spec.id === item.productSpecId)?.spec;
    if (!spec) throw new CatererOperationError("Recipe details are missing for an ordered product.");
    if (count + item.quantity > 2000) throw new CatererOperationError("Choose a shorter date range for at most 2,000 labels.");
    for (let index = 1; index <= item.quantity; index++) {
      count++;
      labels.push(`<article><strong>${escapeHtml(caterer.businessName)}</strong><h2>${escapeHtml(item.name)}</h2><p>${escapeHtml(item.container)}</p><p>For ${escapeHtml(order.customerName)} · ${index}/${item.quantity}</p><small>Order ${escapeHtml(order.id)} · ${escapeHtml(order.fulfillmentDate)}</small><p>Ingredients: ${spec.recipe.ingredients.map(i => escapeHtml(i.name)).join(", ")}</p><p>Allergens reported by caterer: ${spec.recipe.allergens.length ? spec.recipe.allergens.map(escapeHtml).join(", ") : "none listed"}</p><p>${escapeHtml(spec.recipe.storageInstructions)}</p>${parsed.preparedOn ? `<small>Prepared: ${escapeHtml(parsed.preparedOn)}</small>` : ""}${parsed.useBy ? `<small>Use by: ${escapeHtml(parsed.useBy)}</small>` : ""}</article>`);
    }
  }
  return {labelCount: count, html: documentHtml("Distribution labels", `<h1 class="no-print">Distribution labels</h1><p class="no-print">Print this page to paper or PDF. Dates, ingredients, and allergen declarations come from the caterer.</p><section class="labels">${labels.join("")}</section>`)};
}
