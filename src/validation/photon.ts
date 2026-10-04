import { z } from "zod";

export const agentReplySchema = z.object({text: z.string().min(1).max(200000), html: z.string().max(4000000).optional(),
  documentKind: z.enum(["labels", "grocery_demo"]).optional()});
export type AgentReply = z.infer<typeof agentReplySchema>;
