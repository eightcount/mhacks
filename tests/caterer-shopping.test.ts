import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({plan: vi.fn()}));
vi.mock("../src/services/caterer-operations.js", () => ({productionPlan: fake.plan, CatererOperationError: class extends Error {}}));
import { createGroceryList } from "../src/services/grocery-shopping.js";
import { findGroceryOffers } from "../src/services/grocery-offers.js";
import { calculateProduction } from "../src/services/production-math.js";
import type { ProductSpec } from "../src/validation/caterer-operations.js";
const actor = {catererId: "demo", actorUserId: "owner"};
const ingredients = [{name: "Flour", amount: "1250", unit: "g"}];
const fetchMock = vi.fn();
const period = {start: "2030-06-10", end: "2030-06-10"};
beforeEach(() => {
  fake.plan.mockResolvedValue({ingredients}); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
  for (const key of ["INSTACART_API_KEY", "INSTACART_DEMO_MODE", "KROGER_ACCESS_TOKEN", "KROGER_LOCATION_ID"]) vi.stubEnv(key, "");
});
afterEach(() => {vi.unstubAllGlobals(); vi.unstubAllEnvs();});

describe("ingredient shopping providers", () => {
  it("builds a clearly fictional document without calling Instacart, even if a key exists", async () => {
    vi.stubEnv("INSTACART_DEMO_MODE", "true");
    vi.stubEnv("INSTACART_API_KEY", "fictional-test-key");
    const result = await createGroceryList(actor, period);
    expect(result).toMatchObject({status: "DEMO_READY", simulated: true, orderPlaced: false, ingredients,
      documentKind: "grocery_demo", basket: {total: "10.97", items: [{quantity: 2, packAmount: "1000"}]}});
    expect(result.message).toContain("DEMO ONLY");
    expect(result).not.toHaveProperty("url");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("still enforces production ownership and requires accepted ingredients in demo mode", async () => {
    vi.stubEnv("INSTACART_DEMO_MODE", "true");
    fake.plan.mockRejectedValueOnce(new Error("Not authorized"));
    await expect(createGroceryList(actor, period)).rejects.toThrow("Not authorized");
    fake.plan.mockResolvedValue({ingredients: []});
    expect(await createGroceryList(actor, period)).toMatchObject({status: "EMPTY"});
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("returns the real ingredient list and no invented deals when disconnected", async () => {
    expect(await createGroceryList(actor, period)).toMatchObject({status: "NOT_CONNECTED", ingredients});
    expect(await findGroceryOffers(actor, {})).toMatchObject({status: "NOT_CONNECTED", offers: []});
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("creates a measured shopping link without placing an order", async () => {
    vi.stubEnv("INSTACART_API_KEY", "fictional-test-key"); vi.stubEnv("INSTACART_ENVIRONMENT", "development");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({products_link_url: "https://www.instacart.com/store/shopping_lists/test"})));
    expect(await createGroceryList(actor, period)).toMatchObject({status: "READY_FOR_REVIEW"});
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://connect.dev.instacart.tools/idp/v1/products/products_link");
    expect(JSON.parse(options.body)).toMatchObject({line_items: [{name: "Flour", line_item_measurements: [{quantity: 1250, unit: "gram"}]}]});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("sends every combined ingredient from multiple batches in one Instacart request", async () => {
    const spec: ProductSpec = {menuItemId: "33000000-0000-4000-8000-000000000001",
      container: {name: "box", capacity: {amount: "12", unit: "each"}, fill: {amount: "12", unit: "each"}},
      recipe: {name: "Demo", yield: {amount: "60", unit: "each"}, allergens: [], storageInstructions: "",
        ingredients: [{name: "Flour", measure: {amount: "500", unit: "g"}}, {name: "Water", measure: {amount: "300", unit: "ml"}}]}};
    const second: ProductSpec = {...spec, recipe: {...spec.recipe, ingredients: [
      {name: "flour", measure: {amount: "0.25", unit: "kg"}}, {name: "Wrappers", measure: {amount: "60", unit: "each"}}]}};
    const plan = calculateProduction([
      {productSpecId: "first", productName: "First", packages: 6, spec},
      {productSpecId: "second", productName: "Second", packages: 6, spec: second}
    ]);
    fake.plan.mockResolvedValue({...plan, acceptedOrders: 2});
    vi.stubEnv("INSTACART_API_KEY", "fictional-test-key"); vi.stubEnv("INSTACART_ENVIRONMENT", "production");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({products_link_url: "https://www.instacart.com/store/shopping_lists/test"})));
    const result = await createGroceryList(actor, period);
    expect(fake.plan).toHaveBeenCalledWith(actor, period);
    expect(result).toMatchObject({status: "READY_FOR_REVIEW", ingredientCount: 3, period});
    expect(result.message).toContain("No grocery order has been placed");
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://connect.instacart.com/idp/v1/products/products_link");
    expect(JSON.parse(request.body)).toMatchObject({title: "Catering ingredients for 2030-06-10", line_items: [
      {name: "flour", line_item_measurements: [{quantity: 1500, unit: "gram"}]},
      {name: "Water", line_item_measurements: [{quantity: 600, unit: "milliliter"}]},
      {name: "Wrappers", line_item_measurements: [{quantity: 120, unit: "each"}]}
    ]});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not call Instacart without accepted ingredients or for an invalid range", async () => {
    fake.plan.mockResolvedValue({ingredients: []});
    vi.stubEnv("INSTACART_API_KEY", "fictional-test-key");
    expect(await createGroceryList(actor, period)).toMatchObject({status: "EMPTY"});
    await expect(createGroceryList(actor, {start: "2030-02-30", end: "2030-03-01"})).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["timeout", "unauthorized", "invalid link"])("keeps the ingredient list after %s", async failure => {
    vi.stubEnv("INSTACART_API_KEY", "fictional-test-key");
    if (failure === "timeout") fetchMock.mockRejectedValue(new Error("private provider error"));
    else fetchMock.mockResolvedValue(failure === "unauthorized" ? new Response("private provider error", {status: 401})
      : new Response(JSON.stringify({products_link_url: "https://untrusted.example.invalid/list"})));
    const result = await createGroceryList(actor, period);
    expect(result).toMatchObject({status: "UNAVAILABLE", ingredients});
    expect(result.message).not.toContain("private provider error");
    expect(result.message).toContain("no grocery order has been placed");
  });
  it("shows only current positive promotions returned for the configured store", async () => {
    vi.stubEnv("KROGER_ACCESS_TOKEN", "fictional-test-token"); vi.stubEnv("KROGER_LOCATION_ID", "12345678");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({data: [
      {productId: "one", description: "Demo flour", items: [{size: "5 lb", price: {regular: 4.29, promo: 3.19}, fulfillment: {curbside: true}}]},
      {productId: "two", description: "Not a promotion", items: [{price: {regular: 4.29, promo: 0}}]},
      {productId: "three", description: "No current price", items: [{}]}
    ]})));
    const result = await findGroceryOffers(actor, {});
    expect(result).toMatchObject({status: "READY", locationId: "12345678", offers: [{ingredient: "Flour", candidates: [{salePrice: "3.19", savings: "1.10", packSize: "5 lb", pickupAvailable: true}]}]});
    expect(result.offers[0]?.candidates).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("filter.locationId=12345678");
  });
  it("does not turn a provider outage into an empty deals result", async () => {
    vi.stubEnv("KROGER_ACCESS_TOKEN", "fictional-test-token"); vi.stubEnv("KROGER_LOCATION_ID", "12345678");
    fetchMock.mockResolvedValue(new Response("", {status: 401}));
    await expect(findGroceryOffers(actor, {})).rejects.toThrow("Refresh");
  });
});
