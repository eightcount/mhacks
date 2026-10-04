import { productSpecSchema, type Measure, type ProductSpec } from "../validation/caterer-operations.js";

export function baseMeasure(measure: Measure): { amount: bigint; unit: "g" | "ml" | "each" } {
  const [whole = "0", fraction = ""] = measure.amount.split(".");
  const scale = measure.unit === "kg" || measure.unit === "l" ? 1000n : 1n;
  return { amount: (BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"))) * scale,
    unit: measure.unit === "kg" ? "g" : measure.unit === "l" ? "ml" : measure.unit };
}
export function formatMeasure(amount: bigint): string {
  return `${amount / 1000n}.${String(amount % 1000n).padStart(3, "0")}`.replace(/\.?0+$/, "");
}
export function validateProductSpec(input: unknown): ProductSpec {
  const spec = productSpecSchema.parse(input);
  const capacity = baseMeasure(spec.container.capacity), fill = baseMeasure(spec.container.fill), yieldAmount = baseMeasure(spec.recipe.yield);
  if (fill.unit !== capacity.unit || fill.unit !== yieldAmount.unit) throw new Error("Container fill, capacity, and recipe yield must use the same dimension. Supply measured weights or volumes; no density is assumed.");
  if (fill.amount > capacity.amount) throw new Error("Container fill exceeds its capacity.");
  if (fill.unit === "each" && (fill.amount % 1000n || capacity.amount % 1000n || yieldAmount.amount % 1000n)) throw new Error("Counted products need whole-number fill, capacity, and yield.");
  return spec;
}
export interface ProductionLine { productSpecId: string; productName: string; packages: number; spec: ProductSpec }
export function calculateProduction(lines: ProductionLine[]) {
  const ingredients = new Map<string, {name: string; unit: string; amount: bigint}>();
  const products = lines.map(line => {
    if (!Number.isSafeInteger(line.packages) || line.packages < 0) throw new Error("Package count must be a non-negative whole number.");
    const spec = validateProductSpec(line.spec), fill = baseMeasure(spec.container.fill), batchYield = baseMeasure(spec.recipe.yield);
    const required = fill.amount * BigInt(line.packages);
    const batches = (required + batchYield.amount - 1n) / batchYield.amount;
    if (batches > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Batch count is too large; check the recipe yield and container fill.");
    for (const ingredient of spec.recipe.ingredients) {
      const measure = baseMeasure(ingredient.measure);
      let amount = measure.amount * batches;
      if (measure.unit === "each") amount = ((amount + 999n) / 1000n) * 1000n;
      const key = `${ingredient.name.trim().toLocaleLowerCase()}:${measure.unit}`;
      const prior = ingredients.get(key);
      ingredients.set(key, {name: ingredient.name, unit: measure.unit, amount: amount + (prior?.amount ?? 0n)});
    }
    return { productSpecId: line.productSpecId, productName: line.productName, packages: line.packages,
      container: spec.container.name, fill: spec.container.fill, batches: Number(batches),
      requiredProduct: {amount: formatMeasure(required), unit: fill.unit},
      surplus: {amount: formatMeasure(batchYield.amount * batches - required), unit: fill.unit} };
  });
  return { products, ingredients: [...ingredients.values()].map(i => ({name: i.name, amount: formatMeasure(i.amount), unit: i.unit})),
    calculation: "Whole batches, rounded up; ingredient amounts come from the configured recipe. No mass-to-volume conversion is assumed." };
}
