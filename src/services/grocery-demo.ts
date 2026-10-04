import { z } from "zod";
import { documentHtml, escapeHtml as e } from "./document-html.js";
import { baseMeasure, formatMeasure, type calculateProduction } from "./production-math.js";
import { centsToMoney, moneyToCents } from "./money.js";

type Ingredient = ReturnType<typeof calculateProduction>["ingredients"][number];
type Unit = "g" | "ml" | "each";
interface SamplePack {amount: string; unit: Unit; price: string}

// Fictional catalog fixtures, never retailer inventory or live prices.
const defaults: Record<Unit, SamplePack> = {
  g: {amount: "500", unit: "g", price: "3.99"},
  ml: {amount: "1000", unit: "ml", price: "2.49"},
  each: {amount: "12", unit: "each", price: "2.99"}
};
const catalog: Record<string, SamplePack> = {
  flour: {amount: "1000", unit: "g", price: "3.99"},
  rice: {amount: "2000", unit: "g", price: "5.99"},
  wrappers: {amount: "60", unit: "each", price: "4.99"},
  water: {amount: "1000", unit: "ml", price: "1.49"},
  oil: {amount: "1000", unit: "ml", price: "7.49"},
  "soy sauce": {amount: "500", unit: "ml", price: "3.49"}
};

/** Local simulation only. No provider calls, payment, or order writes. */
export function createDemoGroceryBasket(ingredients: Ingredient[], period: {start: string; end: string}) {
  const items = ingredients.map(ingredient => {
    const unit = z.enum(["g", "ml", "each"]).parse(ingredient.unit);
    if (!/^\d+(?:\.\d{1,3})?$/.test(ingredient.amount)) throw new Error("Invalid ingredient quantity.");
    const required = baseMeasure({amount: ingredient.amount, unit}).amount;
    if (required <= 0n) throw new Error("Ingredient quantity must be positive.");
    const match = catalog[ingredient.name.trim().toLowerCase()];
    const pack = match?.unit === unit ? match : defaults[unit];
    const packAmount = baseMeasure(pack).amount;
    const packages = (required + packAmount - 1n) / packAmount;
    if (packages > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Ingredient quantity is too large.");
    const quantity = Number(packages);
    const lineCents = moneyToCents(pack.price) * quantity;
    return {ingredient: ingredient.name, requiredAmount: ingredient.amount, unit,
      productName: `Sample ${ingredient.name}`, packAmount: pack.amount, quantity,
      purchasedAmount: formatMeasure(packAmount * packages), surplusAmount: formatMeasure(packAmount * packages - required),
      unitPrice: pack.price, lineTotal: centsToMoney(lineCents)};
  });
  const subtotalCents = items.reduce((sum, item) => sum + moneyToCents(item.lineTotal), 0);
  const basket = {
    simulated: true, orderPlaced: false, currency: "USD", store: "Demo Grocery Store",
    fulfillment: "PICKUP", pickupWindow: `${period.start}, 10:00–11:00 AM (sample only; not reserved)`,
    items, subtotal: centsToMoney(subtotalCents), serviceFee: "2.99",
    total: centsToMoney(subtotalCents + 299)
  };
  const notice = "DEMO ONLY — store, products, prices, and pickup details are fictional. No order has been placed or paid for.";
  const message = `${notice}\n${basket.store} · Sample pickup\n` +
    items.map(item => `${item.productName}: ${item.quantity} × ${item.packAmount} ${item.unit} at $${item.unitPrice} = $${item.lineTotal}`).join("\n") +
    `\nDemo subtotal: $${basket.subtotal}\nSample service fee: $${basket.serviceFee}\nDemo total: $${basket.total} USD (tax and tip excluded).`;
  const body = `<h1>Instacart ingredient basket — DEMO</h1><article><strong>${e(notice)}</strong></article>
    <p>Ingredient needs for ${e(period.start)}${period.end !== period.start ? ` through ${e(period.end)}` : ""} come from your accepted orders and saved recipes.</p>
    <h2>${e(basket.store)}</h2><p>Sample pickup: ${e(basket.pickupWindow)}</p>
    <p>Every product below is a sample match. Package sizes and prices are demonstration data.</p>
    ${items.map(item => `<article><h2>${e(item.productName)}</h2>
      <p>Recipe need: ${e(item.requiredAmount)} ${e(item.unit)} ${e(item.ingredient)}</p>
      <p>${item.quantity} packages × ${e(item.packAmount)} ${e(item.unit)} · $${e(item.unitPrice)} per package</p>
      <p>Supplied: ${e(item.purchasedAmount)} ${e(item.unit)} · Extra: ${e(item.surplusAmount)} ${e(item.unit)}</p>
      <strong>Sample line total: $${e(item.lineTotal)}</strong></article>`).join("")}
    <article><p>Demo subtotal: $${e(basket.subtotal)}</p><p>Sample service fee: $${e(basket.serviceFee)}</p>
    <h2>Demo total: $${e(basket.total)} USD</h2><p>Tax and tip excluded. No payment or pickup reservation.</p></article>
    <button type="button" disabled>Demo only — checkout unavailable</button>`;
  return {status: "DEMO_READY" as const, simulated: true, orderPlaced: false, basket,
    documentKind: "grocery_demo" as const, message, html: documentHtml("Instacart ingredient basket — DEMO", body)};
}
