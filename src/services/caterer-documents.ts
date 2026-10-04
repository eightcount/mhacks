import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { catererProductSpecs } from "../db/schema/index.js";
import { daySchema, periodSchema } from "../validation/caterer-operations.js";
import { authorizeCaterer, CatererOperationError, listPreorders, type CatererActor } from "./caterer-operations.js";

import { documentHtml, escapeHtml } from "./document-html.js";
export { documentHtml, escapeHtml } from "./document-html.js";

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
