import { z } from "zod";
import { interactiveCardSchema } from "./interactive-cards.js";

export const agentReplySchema = z.object({text: z.string().min(1).max(200000), html: z.string().max(4000000).optional(),
  documentKind: z.enum(["labels", "grocery_demo", "receipt"]).optional(), card: interactiveCardSchema.optional()});
export type AgentReply = z.infer<typeof agentReplySchema>;
