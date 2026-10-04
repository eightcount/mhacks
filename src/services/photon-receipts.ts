import { and, eq } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "../db/index.js";
import { catererAgentSessions, catererNotificationDrafts } from "../db/schema/index.js";
import { authorizeCaterer, CatererOperationError, type CatererActor } from "./caterer-operations.js";
import { agentReplySchema } from "../validation/photon.js";

const keySchema = z.string().regex(/^[a-f0-9]{64}$/);
const receiptSchema = z.object({status: z.enum(["PROCESSING", "READY", "SENDING", "SENT", "FAILED"]),
  reply: agentReplySchema.optional()});
type Receipt = z.infer<typeof receiptSchema>;
const scope = (actor: CatererActor, key: string) => and(eq(catererAgentSessions.catererId, actor.catererId), eq(catererAgentSessions.sessionId, `photon-event:${key}`));

/** Reuses the existing JSON session table for durable transport receipts. */
export async function photonReceipt(actor: CatererActor, input: unknown) {
  await authorizeCaterer(actor);
  const parsed = z.object({key: keySchema, action: z.enum(["claim", "ready", "dispatch", "sent", "failed"]), reply: agentReplySchema.optional()}).strict().parse(input);
  if (parsed.action === "claim") {
    const [created] = await db.insert(catererAgentSessions).values({catererId: actor.catererId, sessionId: `photon-event:${parsed.key}`, draft: {status: "PROCESSING"}})
      .onConflictDoNothing({target: [catererAgentSessions.catererId, catererAgentSessions.sessionId]}).returning();
    if (created) return {claimed: true, status: "PROCESSING"};
    const [existing] = await db.select().from(catererAgentSessions).where(scope(actor, parsed.key));
    return {claimed: false, ...receiptSchema.parse(existing?.draft)};
  }
  const action = parsed.action;
  return db.transaction(async tx => {
    const [row] = await tx.select().from(catererAgentSessions).where(scope(actor, parsed.key)).for("update");
    if (!row) throw new CatererOperationError("Message receipt not found.");
    const prior = receiptSchema.parse(row.draft);
    const expected = {ready: "PROCESSING", dispatch: "READY", sent: "SENDING", failed: "SENDING"}[action];
    if (prior.status !== expected) return {claimed: false, status: prior.status};
    const next: Receipt = parsed.action === "ready" ? {status: "READY", reply: agentReplySchema.parse(parsed.reply)}
      : {...prior, status: parsed.action === "dispatch" ? "SENDING" : parsed.action === "sent" ? "SENT" : "FAILED"};
    await tx.update(catererAgentSessions).set({draft: next, updatedAt: new Date()}).where(eq(catererAgentSessions.id, row.id));
    return {claimed: true, ...next};
  });
}

function documentSignature(actor: CatererActor, key: string, expires: string) {
  const secret = process.env.CATERER_INTERNAL_TOKEN;
  if (!secret || secret.length < 32) throw new CatererOperationError("Document access is not configured.");
  return createHmac("sha256", secret).update(`${actor.catererId}:${key}:${expires}`).digest("hex");
}
export function photonDocumentUrl(actor: CatererActor, key: string): string | undefined {
  const base = process.env.CATERER_PUBLIC_BASE_URL;
  if (!base || !base.startsWith("https://")) return undefined;
  const expires = String(Math.floor(Date.now() / 1000) + 3600);
  return `${base.replace(/\/$/, "")}/documents/${key}?expires=${expires}&signature=${documentSignature(actor, key, expires)}`;
}
export async function readPhotonDocument(actor: CatererActor, key: string, expires: string, signature: string) {
  keySchema.parse(key);
  if (!/^\d{10}$/.test(expires) || !/^[a-f0-9]{64}$/.test(signature) || Number(expires) < Date.now() / 1000 ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(documentSignature(actor, key, expires)))) throw new CatererOperationError("This document link is invalid or has expired. Request the document again from the agent.");
  const [row] = await db.select().from(catererAgentSessions).where(scope(actor, key));
  const html = receiptSchema.parse(row?.draft).reply?.html;
  if (!html) throw new CatererOperationError("Document not found.");
  return html;
}
export async function photonNotification(actor: CatererActor, input: unknown) {
  await authorizeCaterer(actor);
  const {id} = z.object({id: z.string().uuid()}).strict().parse(input);
  const [row] = await db.select().from(catererNotificationDrafts).where(and(eq(catererNotificationDrafts.id, id), eq(catererNotificationDrafts.catererId, actor.catererId), eq(catererNotificationDrafts.status, "SENDING")));
  if (!row) throw new CatererOperationError("Notification is not an approved pending send for this caterer.");
  return {id: row.id, recipient: row.recipient, text: row.body};
}
