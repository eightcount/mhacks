import { z } from "zod";
import { agentReplySchema, type AgentReply } from "../validation/photon.js";
export async function callCatererTool(name: string, input: unknown): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${process.env.CATERER_BACKEND_PORT || 4002}/tools/${name}`, {
    method: "POST", headers: {Authorization: `Bearer ${process.env.CATERER_INTERNAL_TOKEN}`, "Content-Type": "application/json"},
    body: JSON.stringify(input), signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error("Caterer backend request failed. Check its configuration and migration.");
  return response.json();
}
export async function callCatererAgent(sessionId: string, text: string): Promise<AgentReply> {
  const response = await fetch(`http://127.0.0.1:${process.env.CATERER_BRIDGE_PORT || 8003}/caterer/message`, {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({token: process.env.CATERER_INTERNAL_TOKEN, session_id: sessionId, text}), signal: AbortSignal.timeout(120000)
  });
  if (!response.ok) throw new Error("Fetch caterer bridge is unavailable.");
  const result = z.object({ok: z.boolean(), text: z.string(), html: z.string().nullable().optional(),
    documentKind: agentReplySchema.shape.documentKind.nullable(), card: agentReplySchema.shape.card.nullable()}).parse(await response.json());
  if (!result.ok) throw new Error("Fetch caterer bridge could not complete the message.");
  return agentReplySchema.parse({text: result.text, ...(result.html ? {html: result.html} : {}),
    ...(result.documentKind ? {documentKind: result.documentKind} : {}), ...(result.card ? {card: result.card} : {})});
}
