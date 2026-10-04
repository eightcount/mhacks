import { z } from "zod";
import { productionPlan, CatererOperationError, type CatererActor } from "./caterer-operations.js";
import { centsToMoney, moneyToCents } from "./money.js";

// Kroger supplies JSON numeric prices. Convert their decimal representation at
// the boundary; all comparisons and savings calculations use integer cents.
const price = z.union([z.number().finite().nonnegative(), z.string()]).transform(value => String(value))
  .pipe(z.string().regex(/^\d+(?:\.\d{1,2})?$/)).transform(moneyToCents);
const productsSchema = z.object({data: z.array(z.object({productId: z.string(), description: z.string(),
  items: z.array(z.object({size: z.string().optional(), price: z.object({regular: price, promo: price.optional()}).optional(),
    fulfillment: z.object({curbside: z.boolean().optional()}).optional()}))}))});

/** Store-specific candidates, never inferred product substitutions or a quote. */
export async function findGroceryOffers(actor: CatererActor, period: unknown) {
  const plan = await productionPlan(actor, period);
  const ingredients = plan.ingredients;
  const details = {ingredients, period: plan.period, ...(plan.orderId ? {orderId: plan.orderId} : {})};
  const token = process.env.KROGER_ACCESS_TOKEN, locationId = process.env.KROGER_LOCATION_ID;
  if (!ingredients.length) return {status: "EMPTY", ...details, offers: [], message: "There are no accepted orders to shop for."};
  if (!token || !locationId) return {status: "NOT_CONNECTED", ...details, offers: [], message: "Connect a Kroger API access token and choose a store location to check current ingredient promotions."};
  if (!/^\d{1,20}$/.test(locationId)) throw new CatererOperationError("Configure a valid Kroger store location ID.");
  if (ingredients.length > 30) throw new CatererOperationError("Choose a smaller production date range to search up to 30 ingredients at a time.");
  const offers = [];
  // Small bounded batches avoid overwhelming the retailer or the local agent.
  for (let start = 0; start < ingredients.length; start += 4) {
    const found = await Promise.all(ingredients.slice(start, start + 4).map(async ingredient => {
      const url = new URL("https://api.kroger.com/v1/products");
      url.search = new URLSearchParams({"filter.term": ingredient.name, "filter.locationId": locationId, "filter.limit": "5"}).toString();
      const response = await fetch(url, {headers: {Authorization: `Bearer ${token}`, Accept: "application/json"}, signal: AbortSignal.timeout(5000)});
      if (!response.ok) throw new CatererOperationError(response.status === 401 ? "Refresh the Kroger API access token before searching offers." : "Kroger could not provide current prices. Try again later.");
      const result = productsSchema.parse(await response.json());
      const candidates = result.data.flatMap(product => product.items.flatMap(item => {
        if (!item.price) return [];
        const regular = item.price.regular, promo = item.price.promo;
        if (promo === undefined || promo <= 0 || promo >= regular) return [];
        return [{productId: product.productId, name: product.description, packSize: item.size ?? "Not provided",
          regularPrice: centsToMoney(regular), salePrice: centsToMoney(promo), savings: centsToMoney(regular - promo),
          pickupAvailable: item.fulfillment?.curbside ?? null}];
      }));
      return {ingredient: ingredient.name, requiredAmount: ingredient.amount, requiredUnit: ingredient.unit, candidates};
    }));
    offers.push(...found);
  }
  return {status: "READY", source: "Kroger", locationId, checkedAt: new Date().toISOString(), ...details, offers,
    message: "Current promotions among the first five search matches per ingredient at your configured store. Confirm product suitability, pack sizes, promotion terms and pickup availability. No expiry or purchase quantity is inferred."};
}
