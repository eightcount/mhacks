/** Called by verify-photon on its disposable Neon branch; never sends messages. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { callCatererAgent, callCatererTool } from "../src/messaging/caterer-client.js";
import type { AgentReply } from "../src/validation/photon.js";

export async function verifyInteractiveCards(publicBase: string, productSpecId: string) {
  const sessionId = `photon-chat:${randomBytes(32).toString("hex")}`;
  const local = (url: string) => {const parsed = new URL(url); return `${publicBase}${parsed.pathname}${parsed.search}`;};
  async function expose(reply: AgentReply) {
    assert(reply.card);
    const {url} = await callCatererTool("photon_card", {sessionId, reply}) as {url: string};
    assert(url);
    return url;
  }
  async function read(url: string) {
    const response = await fetch(local(url));
    assert.equal(response.status, 200);
    return response.text();
  }
  function csrf(html: string) {
    const token = html.match(/name="csrf" value="([a-f0-9]{64})"/)?.[1];
    assert(token); return token;
  }
  const post = (url: string, body: URLSearchParams, extraHeaders: Record<string, string> = {}) => fetch(local(url), {
    method: "POST", body, headers: {Origin: "https://forms.example.invalid", ...extraHeaders}
  });

  // Real requests with different items/quantities share a single review action.
  const form = await callCatererTool("create_form", {title: "Fictional interactive verification", fulfillmentDate: "2099-09-18",
    closesAt: "2099-09-17T18:00:00-04:00", fulfillmentMethod: "DELIVERY", fulfillmentInstructions: "Fictional delivery area",
    minimumOrder: "0.00", deliveryFee: "0.00", products: [{productSpecId, maxPackages: 20}]}) as {form: {id: string}};
  const {submitPreorder, listPreorders} = await import("../src/services/caterer-operations.js");
  const actor = {catererId: process.env.CATERER_ID!, actorUserId: process.env.CATERER_OWNER_USER_ID!};
  const ids: string[] = [];
  for (const quantity of [1, 2]) {
    const order = await submitPreorder(form.form.id, {submissionId: randomUUID(), customerName: `Fictional card buyer ${quantity}`,
      customerContact: "card-buyer@example.invalid", deliveryAddress: "Fictional test address", items: [{productSpecId, quantity}]});
    ids.push(order.orderId);
  }
  const orders = await callCatererAgent(sessionId, "orders September 18, 2099");
  const url = await expose(orders), html = await read(url);
  assert(html.includes('type="checkbox"') && html.includes("Accept selected"));
  const altered = new URL(url); altered.searchParams.set("signature", "0".repeat(64));
  assert.equal((await fetch(local(altered.href))).status, 400);
  altered.searchParams.set("expires", "1000000000");
  assert.equal((await fetch(local(altered.href))).status, 400);
  assert.equal((await fetch(`${publicBase}${new URL(url).pathname}`)).status, 400);
  const body = new URLSearchParams({csrf: csrf(html), action: "accept"});
  ids.forEach(id => body.append("selected", id));
  const missingCsrf = new URLSearchParams(body); missingCsrf.delete("csrf");
  assert.equal((await post(url, missingCsrf)).status, 400);
  assert.equal((await post(url, body, {Origin: "https://untrusted.example.invalid"})).status, 400);
  const forged = new URLSearchParams(body); forged.set("selected", randomUUID());
  assert.equal((await post(url, forged)).status, 400);
  assert((await listPreorders(actor, {start: "2099-09-18", end: "2099-09-18"})).filter(o => ids.includes(o.id)).every(o => o.status === "REQUESTED"));
  const taps = await Promise.all([post(url, body), post(url, body)]);
  assert(taps.every(response => response.status === 200));
  const resultHtml = await read(url);
  assert(resultHtml.includes("2 order(s) now ACCEPTED"));
  assert(!resultHtml.includes('<form'));
  assert((await listPreorders(actor, {start: "2099-09-18", end: "2099-09-18"})).filter(o => ids.includes(o.id)).every(o => o.status === "ACCEPTED"));
  assert((await (await post(url, body)).text()).includes("2 order(s) now ACCEPTED"));
  console.info("PASS: signed owner cards, CSRF/origin validation, batch acceptance, and concurrent double-tap suppression.");

  // A card issued before a newer text turn cannot change orders.
  const stale = await expose(await callCatererAgent(sessionId, "orders September 18, 2099"));
  const staleBody = new URLSearchParams({csrf: csrf(await read(stale)), action: "complete", selected: ids[0]!});
  await callCatererAgent(sessionId, "menu");
  assert((await (await post(stale, staleBody)).text()).includes("out of date"));
  assert((await listPreorders(actor, {start: "2099-09-18", end: "2099-09-18"})).filter(o => ids.includes(o.id)).every(o => o.status === "ACCEPTED"));

  const picker = await callCatererAgent(sessionId, "new form");
  assert(picker.card);
  const choices = picker.card.fields[0];
  assert(choices?.kind === "choice" && choices.choices.length >= 2, "Need two fictional product specs on the isolated test branch");
  const selected = choices.choices.slice(0, 2).map(c => c.value);
  const pickerUrl = await expose(picker), pickerHtml = await read(pickerUrl);
  const fields = new URLSearchParams({csrf: csrf(pickerHtml), action: "products"});
  selected.forEach((id, i) => {fields.append("selected", id); fields.set(`qty_${id}`, String(20 + i));});
  const picked = await post(pickerUrl, fields);
  assert.equal(picked.status, 200);
  const pickedHtml = await picked.text();
  assert(pickedHtml.includes("What title"));
  const saved = await callCatererTool("session", {sessionId}) as {draft: {data: {products: unknown[]}}};
  assert.deepEqual(saved.draft.data.products, selected.map((id, i) => ({productSpecId: id, maxPackages: 20 + i})));
  const nextUrl = pickedHtml.match(/class="continue" href="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
  assert(nextUrl && (await read(nextUrl)).includes('name="answer"'));
  await callCatererAgent(sessionId, "cancel");
  await callCatererTool("close_form", {formId: form.form.id});
  console.info("PASS: stale cards cannot mutate orders; multiple products and quantities persist through the real Fetch bridge.");
}
