import { documentHtml, escapeHtml as e } from "../services/document-html.js";
import type { InteractiveCard } from "../validation/interactive-cards.js";
import type { PhotonCardRecord } from "../services/photon-cards.js";

function form(card: InteractiveCard, actionUrl: string, csrf: string) {
  const fields = card.fields.map(field => {
    if (field.kind === "choice") return `<fieldset><legend>${e(field.label)}</legend><div class="choices">${field.choices.map(choice =>
      `<label class="choice"><input type="${field.multi ? "checkbox" : "radio"}" name="${e(field.name)}" value="${e(choice.value)}"><span>${e(choice.label)}</span></label>`).join("")}</div></fieldset>`;
    return `<label>${e(field.label)}<input type="${field.kind}" name="${e(field.name)}" ${field.kind === "number" ? 'min="1" max="10000" step="1" inputmode="numeric" placeholder="Packages"' : 'maxlength="4000" autocomplete="off"'}></label>`;
  }).join("");
  return `<form method="post" action="${e(actionUrl)}"><input type="hidden" name="csrf" value="${e(csrf)}">${fields}<div class="actions">${card.actions.map((action, i) =>
    `<button class="${i === 0 ? "primary" : "secondary"}" type="submit" name="action" value="${e(action.id)}" ${action.id === "cancel" ? 'formnovalidate' : ''}>${e(action.label)}</button>`).join("")}</div></form>`;
}

export function photonCardHtml(record: PhotonCardRecord, actionUrl: string, csrf: string, nextUrl?: string, error?: string) {
  const card = record.reply.card!;
  const heading = `<h1>${e(card.title)}</h1>`;
  const review = card.actions.some(a => a.id === "publish_form" || a.id === "send_notification")
    ? `<div class="result">${e(record.reply.text)}</div>` : "";
  const explanation = record.status === "READY" ? (card.actions.some(a => a.id === "accept")
    ? "Tap one or more orders, then choose an action. Accept/decline applies to requested orders; complete applies to accepted orders."
    : card.actions.some(a => a.id === "products") ? "Select each product you want to sell and enter its maximum packages." : "Make your selections below.") : "";
  const body = record.status === "READY" ? `${error ? `<p role="alert" class="error">${e(error)}</p>` : ""}${review}<p>${e(explanation)}</p>${form(card, actionUrl, csrf)}`
    : record.status === "DONE" ? `<div class="result" role="status">${e(record.result?.text || "Done.")}</div>${nextUrl ? `<a class="continue" href="${e(nextUrl)}">Continue to the next card</a>` : "<p>You can return to your conversation.</p>"}`
    : record.status === "PROCESSING" ? '<p role="status">Your selection is being processed. Refresh this page shortly to see the result.</p>'
    : '<p>The result could not be confirmed. Check orders in your conversation before trying again.</p>';
  return documentHtml(card.title, `<style>body{margin:0 auto;padding:20px 16px;max-width:600px}h1{font-size:24px}fieldset{border:0;padding:0;margin:16px 0}legend{font-weight:650;margin-bottom:10px}.choices{display:grid;gap:8px}.choice{display:flex;align-items:center;gap:12px;margin:0;padding:14px;border:1px solid #b8c5ba;border-radius:12px;min-height:48px;cursor:pointer}.choice:has(input:checked){background:#e3eee6;border-color:#244c38}.choice input{width:22px!important;height:22px;flex-shrink:0;accent-color:#244c38}.choice span{overflow-wrap:anywhere}input{display:block;border:1px solid #87998c;border-radius:8px;margin-top:8px}input[type=number]{width:140px}.actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:14px 0}.actions button,.continue{min-height:48px;border-radius:10px;padding:12px;font-weight:600}.secondary{background:#e3e8e4;color:#173424}.continue{display:block;text-align:center;background:#244c38;color:white;text-decoration:none;margin-top:20px}.result{white-space:pre-wrap;overflow-wrap:anywhere}.error{padding:12px;background:#ffeded;color:#802424}button:focus-visible,input:focus-visible,a:focus-visible{outline:3px solid #718fe8;outline-offset:3px}</style>${heading}${body}<p class="muted"><small>Private owner controls · expires after one hour. Keep this card link private.</small></p>`);
}
