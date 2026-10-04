import { z } from "zod";

export const amountSchema = z.string().regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/);
export const measureSchema = z.object({
  amount: amountSchema.refine((value) => /[1-9]/.test(value), "Amount must be positive"),
  unit: z.enum(["g", "kg", "ml", "l", "each"])
}).strict();
export const productSpecSchema = z.object({
  menuItemId: z.string().uuid(),
  container: z.object({ name: z.string().trim().min(1).max(100), capacity: measureSchema, fill: measureSchema }).strict(),
  recipe: z.object({
    name: z.string().trim().min(1).max(200), yield: measureSchema,
    ingredients: z.array(z.object({ name: z.string().trim().min(1).max(150), measure: measureSchema }).strict()).min(1).max(100),
    allergens: z.array(z.string().trim().min(1).max(100)).max(30),
    storageInstructions: z.string().trim().max(1000)
  }).strict()
}).strict();
export type ProductSpec = z.infer<typeof productSpecSchema>;
export type Measure = z.infer<typeof measureSchema>;
export const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Use a real calendar date");
export const periodSchema = z.object({ start: daySchema, end: daySchema }).strict()
  .refine(({start, end}) => end >= start && (Date.parse(end) - Date.parse(start)) / 86400000 <= 31, "Choose a range of at most 32 days");
const money = z.string().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/);
export const formSchema = z.object({
  title: z.string().trim().min(1).max(150), fulfillmentDate: daySchema,
  closesAt: z.string().datetime({offset: true}), fulfillmentMethod: z.enum(["PICKUP", "DELIVERY"]),
  fulfillmentInstructions: z.string().trim().min(1).max(1000),
  minimumOrder: money.default("0.00"), deliveryFee: money.default("0.00"),
  products: z.array(z.object({ productSpecId: z.string().uuid(), maxPackages: z.number().int().min(1).max(10000) }).strict()).min(1).max(50)
}).strict().refine(({products}) => new Set(products.map(p => p.productSpecId)).size === products.length, "List each product once");
export const preorderSchema = z.object({
  submissionId: z.string().uuid(), customerName: z.string().trim().min(1).max(150),
  customerContact: z.string().trim().min(3).max(200),
  deliveryAddress: z.string().trim().max(500).default(""),
  items: z.array(z.object({ productSpecId: z.string().uuid(), quantity: z.number().int().min(1).max(1000) }).strict()).min(1).max(50)
}).strict().refine(({items}) => new Set(items.map(i => i.productSpecId)).size === items.length, "List each product once");
export const statusChangeSchema = z.object({ orderId: z.string().uuid(), status: z.enum(["ACCEPTED", "DECLINED", "CANCELLED", "COMPLETED"]) }).strict();
export const notificationSchema = z.object({
  orderIds: z.array(z.string().uuid()).min(1).max(200),
  deliveryWindow: z.string().trim().min(1).max(200),
  note: z.string().trim().max(500).default("")
}).strict();
