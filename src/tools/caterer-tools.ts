import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { catererAgentSessions, catererOrderForms, menuItems } from "../db/schema/index.js";
import { authorizeCaterer, changePreorderStatus, createOrderForm, draftNotifications, listPreorders, listProductSpecs, productionPlan, saveProductSpec, type CatererActor } from "../services/caterer-operations.js";
import { createLabels } from "../services/caterer-documents.js";
import { createGroceryList } from "../services/grocery-shopping.js";
import { sendCatererNotification } from "../messaging/caterer-notifications.js";
import { findGroceryOffers } from "../services/grocery-offers.js";
import { photonReceipt, photonDocumentUrl, photonNotification } from "../services/photon-receipts.js";

export async function runCatererTool(actor: CatererActor, name: string, input: unknown): Promise<unknown> {
  // Actor comes exclusively from the authenticated API session, never model input.
  switch (name) {
    case "menu": {
      await authorizeCaterer(actor);
      return {items: await db.select().from(menuItems).where(and(eq(menuItems.catererId, actor.catererId), eq(menuItems.active, true)))};
    }
    case "recipes": return {products: await listProductSpecs(actor)};
    case "save_recipe": return {product: await saveProductSpec(actor, input)};
    case "create_form": {
      const form = await createOrderForm(actor, input);
      const base = (process.env.CATERER_PUBLIC_BASE_URL || "http://127.0.0.1:4002").replace(/\/$/, "");
      return {form, url: `${base}/forms/${form!.id}`, message: base.startsWith("https://")
        ? "Share this form link with your customers."
        : "This form is currently available on this computer only. Connect public hosting before sharing it with customers."};
    }
    case "forms": {
      await authorizeCaterer(actor);
      return {forms: await db.select().from(catererOrderForms).where(eq(catererOrderForms.catererId, actor.catererId))};
    }
    case "close_form": {
      await authorizeCaterer(actor);
      const {formId} = z.object({formId: z.string().uuid()}).strict().parse(input);
      const [form] = await db.update(catererOrderForms).set({active: false, updatedAt: new Date()})
        .where(and(eq(catererOrderForms.id, formId), eq(catererOrderForms.catererId, actor.catererId))).returning();
      if (!form) throw new Error("Form not found for this caterer.");
      return {form};
    }
    case "orders": return {orders: await listPreorders(actor, input)};
    case "change_order": return {order: await changePreorderStatus(actor, input)};
    case "production_plan": return productionPlan(actor, input);
    case "labels": return createLabels(actor, input);
    case "grocery_list": return createGroceryList(actor, input);
    case "grocery_offers": return findGroceryOffers(actor, input);
    case "draft_notifications": return {notifications: await draftNotifications(actor, input)};
    case "send_notification": return sendCatererNotification(actor, input);
    case "photon_notification": return photonNotification(actor, input);
    case "photon_receipt": {
      const result = await photonReceipt(actor, input);
      const key = z.object({key: z.string().regex(/^[a-f0-9]{64}$/)}).parse(input).key;
      const documentUrl = "reply" in result && result.reply?.html ? photonDocumentUrl(actor, key) : undefined;
      return {...result, ...(documentUrl ? {documentUrl} : {})};
    }
    case "session": {
      await authorizeCaterer(actor);
      const {sessionId, draft} = z.object({sessionId: z.string().min(1).max(200), draft: z.record(z.unknown()).optional()}).strict().parse(input);
      if (draft !== undefined) {
        if (JSON.stringify(draft).length > 40000) throw new Error("Conversation draft is too large.");
        const [row] = await db.insert(catererAgentSessions).values({catererId: actor.catererId, sessionId, draft})
          .onConflictDoUpdate({target: [catererAgentSessions.catererId, catererAgentSessions.sessionId], set: {draft, updatedAt: new Date()}}).returning();
        return {draft: row!.draft};
      }
      const [row] = await db.select().from(catererAgentSessions).where(and(eq(catererAgentSessions.catererId, actor.catererId), eq(catererAgentSessions.sessionId, sessionId)));
      return {draft: row?.draft ?? {}};
    }
    default: throw new Error("Unknown caterer action.");
  }
}
