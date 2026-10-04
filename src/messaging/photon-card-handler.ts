import type { IncomingMessage, ServerResponse } from "node:http";
import { cardCsrf, claimPhotonCard, createPhotonCard, finishPhotonCard, readPhotonCard, type PhotonCardRecord } from "../services/photon-cards.js";
import { CatererOperationError, type CatererActor } from "../services/caterer-operations.js";
import { callCatererAgent } from "./caterer-client.js";
import { photonCardHtml } from "./photon-card-html.js";
import { documentHtml, escapeHtml as e } from "../services/document-html.js";

/** A signed card can submit only its advertised selection to its bound Fetch chat. */
export async function handlePhotonCardRequest(request: IncomingMessage, response: ServerResponse, actor: CatererActor) {
  const url = new URL(request.url || "/", "http://localhost");
  const id = /^\/cards\/([a-f0-9-]{36})$/.exec(url.pathname)?.[1];
  if (!id) return false;
  const expires = url.searchParams.get("expires") || "", signature = url.searchParams.get("signature") || "";
  const actionUrl = `${url.pathname}?${new URLSearchParams({expires, signature})}`;
  const html = (status: number, body: string) => {response.writeHead(status, {"Content-Type": "text/html; charset=utf-8"}); response.end(body);};
  let record: PhotonCardRecord | undefined;
  try {
    if (request.method !== "GET" && request.method !== "POST") {html(405, "Method not allowed"); return true;}
    record = await readPhotonCard(actor, id, expires, signature);
    if (request.method === "POST") {
      const expectedOrigin = new URL(process.env.CATERER_PUBLIC_BASE_URL!).origin;
      if ((request.headers.origin && request.headers.origin !== expectedOrigin) ||
          request.headers["sec-fetch-site"] === "cross-site") throw new CatererOperationError("Open the card directly from your owner chat before submitting.");
      if (!request.headers["content-type"]?.startsWith("application/x-www-form-urlencoded")) throw new CatererOperationError("Submit using the card controls.");
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 16000) throw new CatererOperationError("Card submission is too large.");
        chunks.push(Buffer.from(chunk));
      }
      const claim = await claimPhotonCard(actor, id, expires, signature, new URLSearchParams(Buffer.concat(chunks).toString("utf8")));
      record = claim.record;
      if (claim.claimed) {
        try {
          const result = await callCatererAgent(record.sessionId, JSON.stringify(claim.selection));
          const next = result.card ? await createPhotonCard(actor, {sessionId: record.sessionId, reply: result}) : {};
          record = await finishPhotonCard(actor, id, result, next.url);
        } catch {
          record = await finishPhotonCard(actor, id);
        }
      }
    }
    if (url.searchParams.get("document") === "1" && record.status === "DONE" && record.result?.html) {
      html(200, record.result.html); return true;
    }
    let page = photonCardHtml(record, actionUrl, cardCsrf(actor, id, record), record.nextUrl);
    if (record.result?.html) page = page.replace("</body>", `<p><a href="${e(actionUrl)}&amp;document=1">View printable document</a></p></body>`);
    html(200, page);
  } catch (error) {
    const message = error instanceof CatererOperationError ? error.message : "This card is unavailable. Request a fresh card in your owner chat.";
    html(400, record?.status === "READY" ? photonCardHtml(record, actionUrl, cardCsrf(actor, id, record), undefined, message)
      : documentHtml("Card unavailable", `<h1>Card unavailable</h1><p>${e(message)}</p>`));
  }
  return true;
}
