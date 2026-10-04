import { z } from "zod";
import { productionPlan, type CatererActor } from "./caterer-operations.js";
import { productionSelectionSchema } from "../validation/caterer-operations.js";
import { createDemoGroceryBasket } from "./grocery-demo.js";

/** Creates a reviewable shopping link. This API does not place a pickup order. */
export async function createGroceryList(actor: CatererActor, input: unknown) {
  const selection = productionSelectionSchema.parse(input);
  const plan = await productionPlan(actor, selection);
  const dates = plan.period;
  if (!plan.ingredients.length) return {status: "EMPTY", ingredients: [], message: "There are no accepted orders to shop for."};
  const details = {ingredients: plan.ingredients, period: dates, ingredientCount: plan.ingredients.length,
    ...(plan.orderId ? {orderId: plan.orderId} : {})};
  if (process.env.INSTACART_DEMO_MODE === "true") return {...details, ...createDemoGroceryBasket(plan.ingredients, dates)};
  const key = process.env.INSTACART_API_KEY;
  if (!key) return {status: "NOT_CONNECTED", ...details, message: "Your complete ingredient list is ready. Instacart isn't connected yet, so I can't create the shopping link. No grocery order has been placed."};
  const environment = process.env.INSTACART_ENVIRONMENT || "development";
  if (!["development", "production"].includes(environment)) return {status: "NOT_CONNECTED", ...details, message: "The Instacart connection needs to be checked. Your ingredient list is below; no grocery order has been placed."};
  const base = environment === "production" ? "https://connect.instacart.com" : "https://connect.dev.instacart.tools";
  const units: Record<string, string> = {g: "gram", ml: "milliliter", each: "each"};
  try {
    const lineItems = plan.ingredients.map(item => {
      const quantity = Number(item.amount), unit = units[item.unit];
      if (!unit || !Number.isFinite(quantity) || quantity <= 0 || quantity > Number.MAX_SAFE_INTEGER / 1000) throw new Error("Unsupported ingredient measurement");
      return {name: item.name, display_text: `${item.amount} ${item.unit} ${item.name}`,
        line_item_measurements: [{quantity, unit}]};
    });
    const title = "orderId" in selection ? `Catering ingredients for one order on ${dates.start}`
      : dates.start === dates.end ? `Catering ingredients for ${dates.start}` : `Catering ingredients: ${dates.start} to ${dates.end}`;
    const response = await fetch(`${base}/idp/v1/products/products_link`, {
      method: "POST", headers: {Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json"},
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({title, link_type: "shopping_list", expires_in: 7,
        instructions: ["orderId" in selection ? "Ingredient requirements for the selected accepted catering order only."
          : "Combined ingredient requirements for all accepted catering orders in the selected dates.",
          "Quantities cover whole recipe batches, rounded up. Check product matches and pack sizes; remove ingredients already on hand.",
          "Select your store, review prices and substitutions, and choose pickup if available before checkout."],
        line_items: lineItems})
    });
    if (!response.ok) throw new Error("Instacart did not return a shopping list");
    const result = z.object({products_link_url: z.string().url()}).parse(await response.json());
    const url = new URL(result.products_link_url);
    const allowedHost = url.hostname === "instacart.com" || url.hostname.endsWith(".instacart.com") ||
      (environment === "development" && (url.hostname === "instacart.tools" || url.hostname.endsWith(".instacart.tools")));
    if (url.protocol !== "https:" || !allowedHost || url.username || url.password) throw new Error("Invalid shopping link");
    return {status: "READY_FOR_REVIEW", ...details, url: url.href,
      message: `${environment === "development" ? "Instacart test link: " : ""}All ${lineItems.length} ingredients are in one Instacart shopping list. Open it to choose your store, review matches, pack sizes, prices and substitutions, then check out for pickup if available. No grocery order has been placed yet.`};
  } catch {
    // Never expose provider responses or credentials, and keep the real list
    // available even if product matching or the external service fails.
    return {status: "UNAVAILABLE", ...details, message: "Instacart couldn't create the shopping link. Your complete ingredient list is below. Try 'order ingredients' again later; no grocery order has been placed."};
  }
}
