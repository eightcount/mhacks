import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { catererProductSpecs } from "../db/schema/index.js";
import { daySchema, periodSchema } from "../validation/caterer-operations.js";
import { authorizeCaterer, CatererOperationError, listPreorders, type CatererActor } from "./caterer-operations.js";

export const escapeHtml = (value: unknown): string => String(value).replace(/[&<>"']/g, character => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[character]!));
export const documentHtml = (title: string, body: string): string => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font:16px system-ui,sans-serif;color:#17211b;max-width:760px;margin:40px auto;padding:20px;background:#fafbf8}h1{font-size:28px}label{display:block;margin:18px 0}input,button,textarea{font:inherit;padding:10px;box-sizing:border-box;max-width:100%}input:not([type=number]),textarea{width:100%}input[type=number]{width:100px}button{background:#244c38;color:white;border:0;cursor:pointer}article{padding:18px;border:1px solid #b8c5ba;margin:12px 0;break-inside:avoid}.muted{color:#59665c}.labels{display:grid;grid-template-columns:1fr 1fr;gap:8px}.labels article{margin:0}small{display:block} @media print{body{margin:0;padding:0;background:white;max-width:none}.no-print{display:none}.labels article{min-height:180px}}</style></head><body>${body}</body></html>`;

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
