import "dotenv/config";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { z } from "zod";
import { runCatererTool } from "../tools/caterer-tools.js";
import { getPublicForm, submitPreorder, CatererOperationError } from "../services/caterer-operations.js";
import { documentHtml, escapeHtml as e } from "../services/caterer-documents.js";
import { DomainError } from "../services/errors.js";
import { readPhotonDocument } from "../services/photon-receipts.js";
import { handlePhotonCardRequest } from "../messaging/photon-card-handler.js";

const actor = z.object({catererId: z.string().uuid(), actorUserId: z.string().uuid()}).parse({
  catererId: process.env.CATERER_ID, actorUserId: process.env.CATERER_OWNER_USER_ID
});
const token = process.env.CATERER_INTERNAL_TOKEN;
if (!token || token.length < 32) throw new Error("Configure CATERER_INTERNAL_TOKEN with at least 32 characters.");
const port = Number(process.env.CATERER_BACKEND_PORT || 4002);

const server = createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  const path = new URL(request.url || "/", "http://localhost").pathname;
  const formMatch = /^\/forms\/([a-f0-9-]+)$/.exec(path);
  const json = (status: number, value: unknown) => {response.writeHead(status, {"Content-Type": "application/json"}); response.end(JSON.stringify(value));};
  const html = (status: number, value: string) => {response.writeHead(status, {"Content-Type": "text/html; charset=utf-8"}); response.end(value);};
  try {
    if (await handlePhotonCardRequest(request, response, actor)) return;
    if (path === "/health") return json(200, {status: "ok", features: ["caterer", "photon"]});
    const documentKey = /^\/documents\/([a-f0-9]{64})$/.exec(path)?.[1];
    if (documentKey && request.method === "GET") {
      const query = new URL(request.url || "/", "http://localhost").searchParams;
      return html(200, await readPhotonDocument(actor, documentKey, query.get("expires") || "", query.get("signature") || ""));
    }
    if (formMatch && request.method === "GET") {
      const form = await getPublicForm(z.string().uuid().parse(formMatch[1]));
      const body = `<h1>${e(form.title)}</h1><p>${e(form.businessName)} · ${e(form.fulfillmentDate)} · ${e(form.fulfillmentMethod.toLowerCase())}</p><p>${e(form.fulfillmentInstructions)}</p><p>Minimum food order: $${e(form.minimumOrder)}. Delivery fee: $${e(form.deliveryFee)}.</p>`;
      if (!form.open) return html(200, documentHtml(form.title, `${body}<p>Orders are closed.</p>`));
      return html(200, documentHtml(form.title, `${body}<form method="post"><input type="hidden" name="submissionId" value="${randomUUID()}"><label>Your name<input name="customerName" required maxlength="150" autocomplete="name"></label><label>Contact for order updates<input name="customerContact" required maxlength="200"></label>${form.fulfillmentMethod === "DELIVERY" ? '<label>Delivery address<textarea name="deliveryAddress" required maxlength="500" autocomplete="street-address"></textarea></label>' : ""}${form.products.map(p => `<article><strong>${e(p.name)}</strong><p>${e(p.container)} · $${e(p.unitPrice)} per package</p><label>Packages <input type="number" name="item:${e(p.productSpecId)}" value="0" min="0" max="${Math.min(1000, p.maxPackages)}" step="1"></label></article>`).join("")}<p>Submitting requests an order. Your caterer must accept it.</p><button type="submit">Request order</button></form>`));
    }
    if (request.method !== "POST") return json(404, {error: "Not found"});
    if (!formMatch) {
      const received = Buffer.from(request.headers.authorization || "");
      const expected = Buffer.from(`Bearer ${token}`);
      if (received.length !== expected.length || !timingSafeEqual(received, expected)) return json(401, {error: "Unauthorized"});
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    // Authenticated transport receipts can include printable label documents.
    const limit = path === "/tools/photon_receipt" ? 16 * 1024 * 1024 : 64000;
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > limit) throw new CatererOperationError("Request is too large.");
      chunks.push(Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks).toString("utf8");
    if (formMatch) {
      const fields = new URLSearchParams(body);
      const result = await submitPreorder(z.string().uuid().parse(formMatch[1]), {
        submissionId: fields.get("submissionId"), customerName: fields.get("customerName"), customerContact: fields.get("customerContact"),
        deliveryAddress: fields.get("deliveryAddress") || "",
        items: [...fields.entries()].filter(([key, value]) => key.startsWith("item:") && value !== "0")
          .map(([key, value]) => ({productSpecId: key.slice(5), quantity: Number(value)}))
      });
      return html(200, documentHtml("Order requested", `<h1>Order requested</h1><p>Reference: ${e(result.orderId)}</p><p>Total: $${e(result.total)}</p><p>Status: ${e(result.status)}. Awaiting caterer acceptance.</p>`));
    }
    const tool = /^\/tools\/([a-z_]+)$/.exec(path)?.[1];
    if (!tool) return json(404, {error: "Not found"});
    return json(200, await runCatererTool(actor, tool, body ? JSON.parse(body) : {}));
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues.map(issue => issue.message).join("; ")
      : error instanceof CatererOperationError || error instanceof DomainError ? error.message
      : "The action could not be completed. Check the input and backend configuration.";
    if (formMatch) return html(400, documentHtml("Unable to submit", `<h1>Unable to submit</h1><p>${e(message)}</p><p>Return to the form to correct your request.</p>`));
    return json(400, {error: message});
  }
});
server.listen(port, process.env.CATERER_BACKEND_HOST || "127.0.0.1", () => {
  const address = server.address();
  console.info(`[caterer-api] listening on port ${typeof address === "object" && address ? address.port : port}`);
});
