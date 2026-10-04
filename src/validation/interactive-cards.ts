import { z } from "zod";

const name = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const choice = z.object({value: z.string().min(1).max(100), label: z.string().min(1).max(500)}).strict();
export const cardFieldSchema = z.discriminatedUnion("kind", [
  z.object({name, kind: z.literal("choice"), label: z.string().max(200), multi: z.boolean(), choices: z.array(choice).min(1).max(50)}).strict(),
  z.object({name, kind: z.enum(["text", "number"]), label: z.string().min(1).max(200)}).strict()
]);
export const cardActionSchema = z.enum(["accept", "decline", "complete", "receipt", "recipe", "choose_products", "products", "answer", "cancel", "send_notification", "publish_form"]);
export const interactiveCardSchema = z.object({id: z.string().uuid(), title: z.string().min(1).max(200),
  fields: z.array(cardFieldSchema).max(51),
  actions: z.array(z.object({id: cardActionSchema, label: z.string().min(1).max(100)}).strict()).min(1).max(6)
}).strict();
export type InteractiveCard = z.infer<typeof interactiveCardSchema>;

/** Values can only address the choices and actions on this exact persisted card. */
export function parseCardSubmission(card: InteractiveCard, fields: URLSearchParams) {
  const action = cardActionSchema.parse(fields.get("action"));
  if (!card.actions.some(a => a.id === action)) throw new Error("Choose an action on this card.");
  const allowed = new Set(["action", "csrf", ...card.fields.map(field => field.name)]);
  if ([...fields.keys()].some(key => !allowed.has(key))) throw new Error("Unknown card field.");
  const selection: Record<string, unknown> = {card_id: card.id, action};
  if (action === "cancel") return selection;
  for (const field of card.fields) {
    const values = fields.getAll(field.name);
    if (field.kind === "choice") {
      if ((!field.multi && values.length > 1) || new Set(values).size !== values.length ||
          values.some(value => !field.choices.some(c => c.value === value))) throw new Error("Choose items shown on this card.");
      if (!values.length) throw new Error("Select at least one item.");
      selection[field.name] = field.multi ? values : values[0];
    } else {
      if (values.length > 1) throw new Error("Repeated card field.");
      const value = values[0] || "";
      if (field.kind === "number" && value && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 10000)) throw new Error("Package limits must be whole numbers from 1 to 10,000.");
      if (value.length > 4000) throw new Error("Please shorten that answer.");
      selection[field.name] = value;
    }
  }
  if (action === "products") {
    for (const id of selection.selected as string[]) {
      if (!selection[`qty_${id}`]) throw new Error("Enter a package limit for every selected product.");
    }
  }
  if (["receipt", "recipe", "send_notification"].includes(action)) {
    const selected = selection.selected;
    if (Array.isArray(selected) && selected.length !== 1) throw new Error("Select one item for this action.");
  }
  return selection;
}
