import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { catererNotificationDrafts } from "../db/schema/index.js";
import { authorizeCaterer, type CatererActor } from "../services/caterer-operations.js";

export async function sendCatererNotification(actor: CatererActor, input: unknown) {
  const {notificationId, confirm} = z.object({notificationId: z.string().uuid(), confirm: z.literal(true)}).strict().parse(input);
  await authorizeCaterer(actor);
  const url = process.env.CATERER_NOTIFICATION_WEBHOOK_URL;
  if (!url) return {status: "NOT_CONNECTED", message: "Notification remains a draft. Connect the Photon/Spectrum transport webhook before sending."};
  const [draft] = await db.update(catererNotificationDrafts).set({status: "SENDING", updatedAt: new Date()})
    .where(and(eq(catererNotificationDrafts.id, notificationId), eq(catererNotificationDrafts.catererId, actor.catererId), eq(catererNotificationDrafts.status, "DRAFT"))).returning();
  if (!draft || !confirm) throw new Error("Notification must be this caterer's unsent draft.");
  try {
    const response = await fetch(url, {method: "POST", headers: {"Content-Type": "application/json", "Idempotency-Key": draft.id,
      ...(process.env.CATERER_NOTIFICATION_WEBHOOK_TOKEN ? {Authorization: `Bearer ${process.env.CATERER_NOTIFICATION_WEBHOOK_TOKEN}`} : {})},
      body: JSON.stringify({id: draft.id, recipient: draft.recipient, text: draft.body}), signal: AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error("Delivery was not confirmed by the messaging provider.");
    const receipt = z.union([
      z.object({delivered: z.literal(true), messageId: z.string().min(1)}),
      z.object({accepted: z.literal(true), messageId: z.string().min(1)})
    ]).parse(await response.json());
    await db.update(catererNotificationDrafts).set({status: "SENT", updatedAt: new Date()}).where(eq(catererNotificationDrafts.id, draft.id));
    return {status: "SENT", messageId: receipt.messageId,
      message: "delivered" in receipt ? "The messaging provider confirmed delivery." : "Submitted to iMessage. Delivery and read receipts are not yet confirmed."};
  } catch {
    await db.update(catererNotificationDrafts).set({status: "FAILED", updatedAt: new Date()}).where(eq(catererNotificationDrafts.id, draft.id));
    return {status: "FAILED", message: "Delivery is unconfirmed. Check the provider before resending to avoid duplicate notifications."};
  }
}
