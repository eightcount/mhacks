import { z } from "zod";
import { normalizeIMessageHandle, photonDigest } from "./photon-config.js";

const inputSchema = z.object({id: z.string().uuid(), recipient: z.string(), text: z.string().min(1)}).strict();
const receiptSchema = z.object({claimed: z.boolean(), status: z.string()});
interface Dependencies {
  projectId: string;
  tool: (name: string, input: unknown) => Promise<unknown>;
  send: (recipient: string, text: string) => Promise<string>;
}

export async function dispatchPhotonNotification(input: unknown, idempotencyKey: unknown, deps: Dependencies) {
  const parsed = inputSchema.parse(input);
  if (idempotencyKey !== parsed.id) throw new Error("Missing notification key");
  const saved = inputSchema.parse(await deps.tool("photon_notification", {id: parsed.id}));
  if (parsed.recipient !== saved.recipient || parsed.text !== saved.text) throw new Error("Notification does not match the saved draft");
  const recipient = normalizeIMessageHandle(saved.recipient);
  if (!recipient) throw new Error("Invalid iMessage contact");
  const key = photonDigest(deps.projectId, "notification", saved.id);
  const claim = receiptSchema.parse(await deps.tool("photon_receipt", {key, action: "claim"}));
  if (!claim.claimed) throw new Error("Send already attempted; check its receipt");
  await deps.tool("photon_receipt", {key, action: "ready", reply: {text: saved.text}});
  const dispatch = receiptSchema.parse(await deps.tool("photon_receipt", {key, action: "dispatch"}));
  if (!dispatch.claimed) throw new Error("Send already attempted");
  try {
    const messageId = await deps.send(recipient, saved.text);
    if (!messageId) throw new Error("No submission receipt");
    await deps.tool("photon_receipt", {key, action: "sent"});
    return {accepted: true as const, messageId};
  } catch (error) {
    await deps.tool("photon_receipt", {key, action: "failed"});
    throw error;
  }
}
