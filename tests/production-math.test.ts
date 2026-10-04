import { describe, expect, it } from "vitest";
import { calculateProduction, validateProductSpec } from "../src/services/production-math.js";
import { periodSchema, preorderSchema } from "../src/validation/caterer-operations.js";
import type { ProductSpec } from "../src/validation/caterer-operations.js";

export const sampleRecipe: ProductSpec = {
  menuItemId: "33000000-0000-4000-8000-000000000001",
  container: {name: "box", capacity: {amount: "12", unit: "each"}, fill: {amount: "12", unit: "each"}},
  recipe: {name: "Fictional dumplings", yield: {amount: "60", unit: "each"},
    ingredients: [{name: "Flour", measure: {amount: "0.5", unit: "kg"}}, {name: "Water", measure: {amount: "300", unit: "ml"}}],
    allergens: ["wheat"], storageInstructions: "Refrigerate"}
};

describe("container and recipe calculations", () => {
  it("rounds to whole batches and explains surplus instead of under-buying", () => {
    const result = calculateProduction([{productSpecId: "one", productName: "Dumplings", packages: 6, spec: sampleRecipe}]);
    expect(result.products[0]).toMatchObject({packages: 6, batches: 2, requiredProduct: {amount: "72", unit: "each"}, surplus: {amount: "48", unit: "each"}});
    expect(result.ingredients).toEqual([{name: "Flour", amount: "1000", unit: "g"}, {name: "Water", amount: "600", unit: "ml"}]);
  });
  it("adds compatible ingredient units exactly across products", () => {
    const second = structuredClone(sampleRecipe);
    second.recipe.ingredients = [{name: "flour", measure: {amount: "0.125", unit: "g"}}];
    const result = calculateProduction([
      {productSpecId: "one", productName: "A", packages: 5, spec: sampleRecipe},
      {productSpecId: "two", productName: "B", packages: 5, spec: second}
    ]);
    expect(result.ingredients.find(i => i.unit === "g")?.amount).toBe("500.125");
  });
  it("does not mix mass and volume for an ingredient with the same name", () => {
    const spec = structuredClone(sampleRecipe);
    spec.recipe.ingredients = [{name: "Water", measure: {amount: "1", unit: "kg"}}, {name: "Water", measure: {amount: "1", unit: "l"}}];
    expect(calculateProduction([{productSpecId: "one", productName: "A", packages: 1, spec}]).ingredients).toHaveLength(2);
  });
  it("supports measured volume with headroom", () => {
    const spec = structuredClone(sampleRecipe);
    spec.container = {name: "tub", capacity: {amount: "750", unit: "ml"}, fill: {amount: "0.6", unit: "l"}};
    spec.recipe.yield = {amount: "3", unit: "l"};
    expect(calculateProduction([{productSpecId: "one", productName: "Soup", packages: 5, spec}]).products[0]).toMatchObject({batches: 1, surplus: {amount: "0", unit: "ml"}});
  });
  it("rejects guessed density conversions and overfilled containers", () => {
    const spec = structuredClone(sampleRecipe);
    spec.container.capacity = {amount: "500", unit: "ml"};
    expect(() => validateProductSpec(spec)).toThrow("same dimension");
    spec.container.capacity = {amount: "10", unit: "each"};
    expect(() => validateProductSpec(spec)).toThrow("exceeds");
  });
  it("rejects zero yield, fractional product counts, and invalid package quantities", () => {
    const spec = structuredClone(sampleRecipe);
    spec.recipe.yield.amount = "0";
    expect(() => validateProductSpec(spec)).toThrow();
    spec.recipe.yield.amount = "0.5";
    expect(() => validateProductSpec(spec)).toThrow("whole-number");
    expect(() => calculateProduction([{productSpecId: "one", productName: "A", packages: -1, spec: sampleRecipe}])).toThrow("Package count");
  });
  it("validates calendar ranges and prevents client-supplied prices", () => {
    expect(periodSchema.safeParse({start: "2030-02-30", end: "2030-03-01"}).success).toBe(false);
    expect(periodSchema.safeParse({start: "2030-01-01", end: "2030-03-01"}).success).toBe(false);
    expect(preorderSchema.safeParse({submissionId: sampleRecipe.menuItemId, customerName: "Fictional", customerContact: "demo@example.invalid", items: [{productSpecId: sampleRecipe.menuItemId, quantity: 1, unitPrice: "0.01"}]}).success).toBe(false);
  });
});
