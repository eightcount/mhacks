/** Real local HTTP + Fetch + isolated Neon verification. No Photon connection or sends. */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { parse } from "dotenv";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { routePhotonMessage } from "../src/messaging/photon-router.js";
import { createPublicCatererServer } from "../src/messaging/photon-public.js";

async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {server.once("error", reject); server.listen(0, "127.0.0.1", resolve);});
  const address = server.address(); assert(address && typeof address === "object");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}
async function main() {
  const isolated = parse(readFileSync(".env.caterer-test")), shared = parse(readFileSync(".env"));
  assert(isolated.DATABASE_URL && shared.DATABASE_URL, "Missing local test configuration");
  assert.notEqual(new URL(isolated.DATABASE_URL).hostname, new URL(shared.DATABASE_URL).hostname, "Refusing to verify against the shared database");
  const backendPort = await availablePort(), bridgePort = await availablePort();
  Object.assign(process.env, isolated, {
    CATERER_ID: "22000000-0000-4000-8000-000000000001", CATERER_OWNER_USER_ID: "11000000-0000-4000-8000-000000000001",
    CATERER_INTERNAL_TOKEN: randomBytes(32).toString("hex"), FETCH_CATERER_SEED: randomBytes(32).toString("hex"),
    CATERER_BACKEND_HOST: "127.0.0.1", CATERER_BACKEND_PORT: String(backendPort), CATERER_BRIDGE_PORT: String(bridgePort),
    CATERER_PUBLIC_BASE_URL: "https://forms.example.invalid", CATERER_NOTIFICATION_WEBHOOK_URL: "",
    INSTACART_API_KEY: "", INSTACART_DEMO_MODE: "true"
  });
  const {db, closeDatabaseConnection} = await import("../src/db/index.js");
  const {callCatererAgent, callCatererTool} = await import("../src/messaging/caterer-client.js");
  const {photonReceipt} = await import("../src/services/photon-receipts.js");
  const children: ChildProcess[] = [];
  const publicServer = createPublicCatererServer(backendPort);
  const start = (command: string, args: string[]) => {
    const child = spawn(command, args, {env: process.env, stdio: "ignore"}); children.push(child);
    child.once("error", () => {process.exitCode = 1;}); return child;
  };
  async function health(url: string, child: ChildProcess) {
    for (let i = 0; i < 160; i++) {
      assert(child.exitCode === null, "A verification process exited unexpectedly");
      try {if ((await fetch(url, {signal: AbortSignal.timeout(1000)})).ok) return;} catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error("Verification startup timed out");
  }
  try {
    const backend = start("node", ["--import", "tsx", "src/agent/caterer-api.ts"]);
    await health(`http://127.0.0.1:${backendPort}/health`, backend);
    const bridge = start(".venv/bin/python", ["-m", "fetch_agent.caterer_bridge"]);
    await health(`http://127.0.0.1:${bridgePort}/caterer/health`, bridge);
    console.info("PASS: real local backend and Fetch uAgent started.");
    const unauthorized = await fetch(`http://127.0.0.1:${bridgePort}/caterer/message`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({token: "wrong".repeat(8), session_id: `photon-chat:${"b".repeat(64)}`, text: "menu"})});
    assert.equal((await unauthorized.json() as {ok: boolean}).ok, false);
    const owner = "fictional-owner@example.invalid";
    const message = {id: randomUUID(), chatId: randomUUID(), line: "fictional-line", sender: owner, text: "menu", direction: "inbound", platform: "imessage", chatType: "dm", timestamp: new Date()};
    const replies: string[] = [];
    let agentCalls = 0;
    const deps = {projectId: "verification-only", owner, startedAt: 0, tool: callCatererTool,
      agent: async (session: string, text: string) => {agentCalls++; return callCatererAgent(session, text);},
      send: async (_chat: string, text: string) => {replies.push(text);}};
    assert.equal(await routePhotonMessage({...message, sender: "stranger@example.invalid"}, deps), "IGNORED");
    assert.equal(await routePhotonMessage(message, deps), "SENT");
    assert(replies[0]?.includes("$"), "Menu must come from backend prices");
    assert.equal(await routePhotonMessage(message, {...deps}), "DUPLICATE");
    assert.equal(agentCalls, 1); assert.equal(replies.length, 1);
    console.info("PASS: owner message → Fetch → backend → Neon; duplicate and unauthorized events suppressed.");

    const dateSession = `photon-chat:${randomBytes(32).toString("hex")}`;
    const selectedDay = {start: "2030-06-10", end: "2030-06-10"};
    const savedPeriod = async () => {
      const result = await callCatererTool("session", {sessionId: dateSession}) as {draft: {period: unknown}};
      return result.draft.period;
    };
    for (const text of ["June 10, 2030", "plan", "order ingredients"]) {
      const reply = await callCatererAgent(dateSession, text);
      assert(reply.text.includes("June 10, 2030"), "Report must retain the selected day and year");
      assert.deepEqual(await savedPeriod(), selectedDay);
    }
    const invalidDate = await callCatererAgent(dateSession, "February 30th");
    assert(invalidDate.text.includes("valid calendar date"));
    assert.deepEqual(await savedPeriod(), selectedDay);
    const currentYear = new Intl.DateTimeFormat("en-US", {year: "numeric", ...(process.env.CATERER_TIMEZONE ? {timeZone: process.env.CATERER_TIMEZONE} : {})}).format(new Date());
    const freshDate = await callCatererAgent(dateSession, "orders October 10");
    assert(freshDate.text.includes(`October 10, ${currentYear}`), "A new date must not inherit the previous search year");
    assert.deepEqual(await savedPeriod(), {start: `${currentYear}-10-10`, end: `${currentYear}-10-10`});
    console.info("PASS: natural single-day orders, persisted report dates, combined grocery command, and invalid-date recovery.");

    // A genuinely competing database claim, independent of process memory.
    const key = randomBytes(32).toString("hex");
    const claims = await Promise.all([1, 2].map(() => callCatererTool("photon_receipt", {key, action: "claim"}) as Promise<{claimed: boolean}>));
    assert.equal(claims.filter(result => result.claimed).length, 1);
    await assert.rejects(photonReceipt({catererId: process.env.CATERER_ID!, actorUserId: "11000000-0000-4000-8000-000000000002"}, {key, action: "claim"}));
    const labelHtml = "<p>Fictional 🥟 label</p>".repeat(5000);
    const label = await callCatererTool("photon_receipt", {key, action: "ready", reply: {text: "Test labels", html: labelHtml}}) as {documentUrl: string};
    assert(label.documentUrl);
    await new Promise<void>(resolve => publicServer.listen(0, "127.0.0.1", resolve));
    const address = publicServer.address(); assert(address && typeof address === "object");
    const publicBase = `http://127.0.0.1:${address.port}`, signed = new URL(label.documentUrl);
    const labels = await fetch(`${publicBase}${signed.pathname}${signed.search}`);
    assert.equal(labels.status, 200); assert.equal(await labels.text(), labelHtml);
    signed.searchParams.set("expires", "1000000000");
    assert.equal((await fetch(`${publicBase}${signed.pathname}${signed.search}`)).status, 400);
    assert.equal((await fetch(`${publicBase}${signed.pathname}`)).status, 400);
    assert.equal((await fetch(`${publicBase}/tools/menu`, {method: "POST"})).status, 404);
    assert.equal((await fetch(`${publicBase}/caterer/message`, {method: "POST"})).status, 404);
    console.info("PASS: concurrent database claims, ownership, private label access, and restricted public gateway.");

    // Fictional catering fixtures only on the disposable database branch.
    const spec = await callCatererTool("save_recipe", {
      menuItemId: "33000000-0000-4000-8000-000000000001",
      container: {name: "test box", capacity: {amount: "12", unit: "each"}, fill: {amount: "12", unit: "each"}},
      recipe: {name: "Demo shopping verification", yield: {amount: "60", unit: "each"},
        ingredients: [{name: "Flour", measure: {amount: "500", unit: "g"}},
          {name: "Water", measure: {amount: "300", unit: "ml"}},
          {name: "Wrappers", measure: {amount: "60", unit: "each"}}], allergens: [], storageInstructions: "Test fixture"}
    }) as {product: {id: string}};
    const form = await callCatererTool("create_form", {title: "Fictional grocery verification", fulfillmentDate: "2099-08-17",
      closesAt: "2099-08-16T18:00:00-04:00", fulfillmentMethod: "DELIVERY", fulfillmentInstructions: "Fictional test area",
      minimumOrder: "0.00", deliveryFee: "0.00", products: [{productSpecId: spec.product.id, maxPackages: 6}]}) as {form: {id: string}};
    const {submitPreorder} = await import("../src/services/caterer-operations.js");
    const order = await submitPreorder(form.form.id, {submissionId: randomUUID(), customerName: "Fictional grocery customer",
      customerContact: "grocery-test@example.invalid", deliveryAddress: "Fictional test address",
      items: [{productSpecId: spec.product.id, quantity: 6}]});
    await callCatererTool("change_order", {orderId: order.orderId, status: "ACCEPTED"});
    const replyStart = replies.length;
    const shoppingMessage = {...message, id: randomUUID(), text: "order ingredients August 17, 2099"};
    assert.equal(await routePhotonMessage(shoppingMessage, deps), "SENT");
    const shoppingReply = replies.slice(replyStart).join("");
    assert(shoppingReply.includes("DEMO ONLY"));
    assert(shoppingReply.includes("View your demo grocery basket"));
    const demoLink = shoppingReply.match(/https:\/\/forms\.example\.invalid\/documents\/\S+/)?.[0];
    assert(demoLink, "The demo must have a signed document link");
    const demoUrl = new URL(demoLink);
    const demoDocument = await fetch(`${publicBase}${demoUrl.pathname}${demoUrl.search}`);
    assert.equal(demoDocument.status, 200);
    const demoHtml = await demoDocument.text();
    assert(demoHtml.includes("DEMO ONLY") && demoHtml.includes("Sample Wrappers") && demoHtml.includes("checkout unavailable"));
    assert.equal(await routePhotonMessage(shoppingMessage, deps), "DUPLICATE");
    mkdirSync("artifacts", {recursive: true});
    writeFileSync("artifacts/caterer-groceries-demo.html", demoHtml);

    // Request a receipt through the same owner chat, with in-memory outbound replies.
    assert.equal(await routePhotonMessage({...message, id: randomUUID(), text: "orders August 17, 2099"}, deps), "SENT");
    const listed = await callCatererTool("orders", {start: "2099-08-17", end: "2099-08-17"}) as {orders: {id: string}[]};
    const receiptNumber = listed.orders.findIndex(item => item.id === order.orderId) + 1;
    assert(receiptNumber > 0);
    const receiptStart = replies.length;
    const receiptMessage = {...message, id: randomUUID(), text: `receipt ${receiptNumber}`};
    assert.equal(await routePhotonMessage(receiptMessage, deps), "SENT");
    const receiptReply = replies.slice(receiptStart).join("");
    assert(receiptReply.includes(`Order: ${order.orderId}`));
    assert(receiptReply.includes(`Total: $${order.total}`));
    assert(receiptReply.includes("Order status: ACCEPTED") && receiptReply.includes("does not confirm payment"));
    assert(receiptReply.includes("View or print your receipt"));
    const receiptLink = receiptReply.match(/https:\/\/forms\.example\.invalid\/documents\/\S+/)?.[0];
    assert(receiptLink);
    const receiptUrl = new URL(receiptLink);
    const receiptDocument = await fetch(`${publicBase}${receiptUrl.pathname}${receiptUrl.search}`);
    assert.equal(receiptDocument.status, 200);
    const receiptHtml = await receiptDocument.text();
    assert(receiptHtml.includes(order.orderId) && receiptHtml.includes(`$${order.total}`));
    assert.equal((await fetch(`${publicBase}${receiptUrl.pathname}`)).status, 400);
    assert.equal(await routePhotonMessage(receiptMessage, deps), "DUPLICATE");
    const {createOrderReceipt} = await import("../src/services/caterer-documents.js");
    await assert.rejects(createOrderReceipt({catererId: "22000000-0000-4000-8000-000000000002", actorUserId: "11000000-0000-4000-8000-000000000002"}, {orderId: order.orderId}));
    writeFileSync("artifacts/caterer-receipt-demo.html", receiptHtml);
    console.info("PASS: listed order → Fetch → itemized receipt and signed printable document; foreign and unsigned access rejected.");

    const notificationSession = `photon-chat:${randomBytes(32).toString("hex")}`;
    await callCatererAgent(notificationSession, "notify August 17, 2099");
    await callCatererAgent(notificationSession, "August 17, 2–3 PM Eastern");
    const notificationState = await callCatererTool("session", {sessionId: notificationSession}) as {draft: {notifications: string[]}};
    const notificationId = notificationState.draft.notifications[0];
    assert(notificationId);
    const redirected = await callCatererAgent(notificationSession, "notification 1 to +1 (202) 555-0143");
    assert(redirected.text.includes("+12025550143") && redirected.text.includes("Nothing has been sent"));
    const {catererNotificationDrafts, catererPreorders} = await import("../src/db/schema/index.js");
    const {eq} = await import("drizzle-orm");
    const [draft] = await db.select().from(catererNotificationDrafts).where(eq(catererNotificationDrafts.id, notificationId));
    assert(draft && draft.status === "DRAFT" && draft.recipient === "+12025550143");
    const [originalOrder] = await db.select().from(catererPreorders).where(eq(catererPreorders.id, draft.orderId));
    assert.equal(originalOrder?.customerContact, "grocery-test@example.invalid");
    // Exercise the simple command with the outbound transport explicitly disabled above.
    const send = await callCatererAgent(notificationSession, "send notification");
    assert(send.text.includes("Notification remains a draft. Connect"));
    const [unsent] = await db.select().from(catererNotificationDrafts).where(eq(catererNotificationDrafts.id, notificationId));
    assert(unsent && unsent.status === "DRAFT" && unsent.recipient === "+12025550143");
    const invalidPhone = await callCatererAgent(notificationSession, "notification 1 to 2025550143");
    assert(invalidPhone.text.includes("country code"));
    const {updateNotificationRecipient} = await import("../src/services/caterer-operations.js");
    await assert.rejects(updateNotificationRecipient({catererId: "22000000-0000-4000-8000-000000000002", actorUserId: "11000000-0000-4000-8000-000000000002"}, {notificationId, recipient: "+12025550144"}));
    // Model an already claimed test draft without calling a messaging transport.
    await db.update(catererNotificationDrafts).set({status: "SENDING"}).where(eq(catererNotificationDrafts.id, notificationId));
    const claimed = await callCatererAgent(notificationSession, "notification 1 to +12025550144");
    assert(claimed.text.includes("Only your unsent notification drafts"));
    const [unchanged] = await db.select().from(catererNotificationDrafts).where(eq(catererNotificationDrafts.id, notificationId));
    assert.equal(unchanged?.recipient, "+12025550143");
    console.info("PASS: simple send uses the saved draft; manual phone persists and rejects invalid, foreign, or claimed edits.");

    await callCatererTool("close_form", {formId: form.form.id});
    await callCatererTool("change_order", {orderId: order.orderId, status: "COMPLETED"});
    console.info("PASS: accepted orders → sample grocery basket → Fetch → signed phone document, with no retailer calls.");
    const menuReply = await callCatererAgent(notificationSession, "menu");
    assert(menuReply.text.length > 0 && !menuReply.card);
    console.info("PASS: iMessage bridge returns text without interactive cards.");
    console.info("No real messages sent; shared database unchanged.");
  } finally {
    publicServer.closeAllConnections(); publicServer.close();
    for (const child of children) child.kill("SIGTERM");
    const cleanup = setTimeout(() => {for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");}, 2000); cleanup.unref();
    await closeDatabaseConnection();
  }
}
main().catch(error => {console.error("Photon verification failed:", error instanceof Error ? error.name : "unknown error"); process.exitCode = 1;});
