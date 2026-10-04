import { and, eq } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "../db/index.js";
import { catererAgentSessions } from "../db/schema/index.js";
import { authorizeCaterer, CatererOperationError, type CatererActor } from "./caterer-operations.js";
import { agentReplySchema, type AgentReply } from "../validation/photon.js";
import { parseCardSubmission } from "../validation/interactive-cards.js";

const recordSchema = z.object({sessionId: z.string().regex(/^photon-chat:[a-f0-9]{64}$/),
  expires: z.number().int(), status: z.enum(["READY", "PROCESSING", "DONE", "FAILED"]),
  reply: agentReplySchema, result: agentReplySchema.optional(), nextUrl: z.string().optional()});
export type PhotonCardRecord = z.infer<typeof recordSchema>;
const scope = (actor: CatererActor, id: string) => and(eq(catererAgentSessions.catererId, actor.catererId), eq(catererAgentSessions.sessionId, `photon-card:${id}`));

function signature(actor: CatererActor, id: string, expires: number, purpose: "view" | "submit") {
  const secret = process.env.CATERER_INTERNAL_TOKEN;
  if (!secret || secret.length < 32) throw new CatererOperationError("Card access is not configured.");
  return createHmac("sha256", secret).update(`card:${purpose}:${actor.catererId}:${id}:${expires}`).digest("hex");
}
function matches(received: string, expected: string) {
  return /^[a-f0-9]{64}$/.test(received) && timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}
export function cardCsrf(actor: CatererActor, id: string, record: PhotonCardRecord) {
  return signature(actor, id, record.expires, "submit");
}
function cardUrl(actor: CatererActor, id: string, expires: number) {
  const base = process.env.CATERER_PUBLIC_BASE_URL;
  if (!base?.startsWith("https://")) return undefined;
  return `${base.replace(/\/$/, "")}/cards/${id}?expires=${expires}&signature=${signature(actor, id, expires, "view")}`;
}

/** A private, expiring capability for one card in one authenticated owner chat. */
export async function createPhotonCard(actor: CatererActor, input: unknown) {
  await authorizeCaterer(actor);
  const {sessionId, reply} = z.object({sessionId: recordSchema.shape.sessionId, reply: agentReplySchema}).strict().parse(input);
  if (!reply.card) throw new CatererOperationError("No interactive card in this reply.");
  if (!process.env.CATERER_PUBLIC_BASE_URL?.startsWith("https://")) return {};
  const id = reply.card.id;
  const draft: PhotonCardRecord = {sessionId, reply, status: "READY", expires: Math.floor(Date.now() / 1000) + 3600};
  const [created] = await db.insert(catererAgentSessions).values({catererId: actor.catererId, sessionId: `photon-card:${id}`, draft})
    .onConflictDoNothing({target: [catererAgentSessions.catererId, catererAgentSessions.sessionId]}).returning();
  const [existing] = created ? [created] : await db.select().from(catererAgentSessions).where(scope(actor, id));
  const saved = recordSchema.parse(existing?.draft);
  if (saved.sessionId !== sessionId) throw new CatererOperationError("Card conversation mismatch.");
  return {url: cardUrl(actor, id, saved.expires)};
}

export async function readPhotonCard(actor: CatererActor, id: string, expires: string, receivedSignature: string) {
  z.string().uuid().parse(id);
  if (!/^\d{10}$/.test(expires) || Number(expires) < Date.now() / 1000 ||
      !matches(receivedSignature, signature(actor, id, Number(expires), "view"))) {
    throw new CatererOperationError("This card link is invalid or expired. Request a fresh card in your owner chat.");
  }
  const [row] = await db.select().from(catererAgentSessions).where(scope(actor, id));
  if (!row) throw new CatererOperationError("Card not found.");
  const record = recordSchema.parse(row.draft);
  if (record.expires !== Number(expires)) throw new CatererOperationError("Card expiry mismatch.");
  return record;
}

export async function claimPhotonCard(actor: CatererActor, id: string, expires: string, receivedSignature: string, fields: URLSearchParams) {
  const current = await readPhotonCard(actor, id, expires, receivedSignature);
  if (!matches(fields.get("csrf") || "", cardCsrf(actor, id, current))) throw new CatererOperationError("Open this card again before submitting.");
  if (!current.reply.card) throw new CatererOperationError("Card not found.");
  let selection: Record<string, unknown>;
  try {selection = parseCardSubmission(current.reply.card, fields);}
  catch (error) {throw new CatererOperationError(error instanceof Error ? error.message : "Check your selection.");}
  return db.transaction(async tx => {
    const [row] = await tx.select().from(catererAgentSessions).where(scope(actor, id)).for("update");
    const record = recordSchema.parse(row?.draft);
    if (record.status !== "READY") return {claimed: false as const, record};
    const next: PhotonCardRecord = {...record, status: "PROCESSING"};
    await tx.update(catererAgentSessions).set({draft: next, updatedAt: new Date()}).where(scope(actor, id));
    return {claimed: true as const, record: next, selection};
  });
}

export async function finishPhotonCard(actor: CatererActor, id: string, result?: AgentReply, nextUrl?: string) {
  await authorizeCaterer(actor);
  // No callback is automatically retried after a timeout or uncertain result.
  return db.transaction(async tx => {
    const [row] = await tx.select().from(catererAgentSessions).where(scope(actor, id)).for("update");
    const record = recordSchema.parse(row?.draft);
    if (record.status !== "PROCESSING") return record;
    const next: PhotonCardRecord = {...record, status: result ? "DONE" : "FAILED",
      ...(result ? {result: agentReplySchema.parse(result)} : {}), ...(nextUrl ? {nextUrl} : {})};
    await tx.update(catererAgentSessions).set({draft: next, updatedAt: new Date()}).where(scope(actor, id));
    return next;
  });
}
