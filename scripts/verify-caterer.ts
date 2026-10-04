/** Run only against a disposable, already migrated branch. No external sends. */
import { parse } from "dotenv";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";

async function main() {
  const testEnv = parse(readFileSync(".env.caterer-test"));
  const sharedEnv = parse(readFileSync(".env"));
  assert(testEnv.DATABASE_URL, "Missing isolated branch connection");
  assert.notEqual(new URL(testEnv.DATABASE_URL).hostname, new URL(sharedEnv.DATABASE_URL!).hostname, "Verification must use a separate branch");
  Object.assign(process.env, testEnv);
  const {db, closeDatabaseConnection} = await import("../src/db/index.js");
  const {catererPreorders, catererOrderForms, menuItems} = await import("../src/db/schema/index.js");
  const {eq} = await import("drizzle-orm");
  const service = await import("../src/services/caterer-operations.js");
  const {createLabels} = await import("../src/services/caterer-documents.js");
  const {runCatererTool} = await import("../src/tools/caterer-tools.js");
  const actor = {catererId: "22000000-0000-4000-8000-000000000001", actorUserId: "11000000-0000-4000-8000-000000000001"};
  const other = {catererId: "22000000-0000-4000-8000-000000000002", actorUserId: "11000000-0000-4000-8000-000000000002"};
  try {
    const menuId = "33000000-0000-4000-8000-000000000001";
    const [menu] = await db.select().from(menuItems).where(eq(menuItems.id, menuId));
    assert(menu, "The disposable branch needs the repository's fictional seed data.");
    const spec = await service.saveProductSpec(actor, {menuItemId: menuId,
      container: {name: "demo box", capacity: {amount: "12", unit: "each"}, fill: {amount: "12", unit: "each"}},
      recipe: {name: "Fictional test recipe", yield: {amount: "60", unit: "each"},
        ingredients: [{name: "Flour", measure: {amount: "500", unit: "g"}}], allergens: ["wheat"], storageInstructions: "Demo storage instructions"}});
    assert(spec);
    const form = await service.createOrderForm(actor, {title: "Fictional workflow verification", fulfillmentDate: "2099-06-15",
      closesAt: "2099-06-10T18:00:00-04:00", fulfillmentMethod: "DELIVERY", fulfillmentInstructions: "Fictional demo area",
      minimumOrder: "0.00", deliveryFee: "3.25", products: [{productSpecId: spec.id, maxPackages: 6}]});
    assert(form);
    const request = {submissionId: randomUUID(), customerName: "Fictional workflow customer", customerContact: "workflow@example.invalid",
      deliveryAddress: "Fictional demo street", items: [{productSpecId: spec.id, quantity: 3}]};
    const first = await service.submitPreorder(form.id, request);
    assert.deepEqual(await service.submitPreorder(form.id, request), first);
    assert.equal(first.status, "REQUESTED");
    // Two simultaneous buyers contend for the final three packages.
    const competing = await Promise.allSettled([1, 2].map(() => service.submitPreorder(form.id, {...request, submissionId: randomUUID()})));
    assert.equal(competing.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(competing.filter(r => r.status === "rejected").length, 1);
    const second = competing.find(r => r.status === "fulfilled");
    assert(second?.status === "fulfilled");
    await assert.rejects(service.changePreorderStatus(other, {orderId: first.orderId, status: "ACCEPTED"}));
    await service.changePreorderStatus(actor, {orderId: first.orderId, status: "ACCEPTED"});
    await service.changePreorderStatus(actor, {orderId: second.value.orderId, status: "ACCEPTED"});
    const range = {start: "2099-06-15", end: "2099-06-15"};
    const plan = await service.productionPlan(actor, range);
    const line = plan.products.find(product => product.productSpecId === spec.id);
    assert.equal(line?.packages, 6); assert.equal(line.batches, 2); assert.equal(line.surplus.amount, "48");
    const labels = await createLabels(actor, range);
    assert(labels.labelCount >= 6);
    const drafts = await service.draftNotifications(actor, {orderIds: [first.orderId, second.value.orderId], deliveryWindow: "June 15, 2–3 pm"});
    assert.equal(drafts.length, 2); assert(drafts.every(draft => draft.status === "DRAFT"));
    await runCatererTool(actor, "session", {sessionId: "verification", draft: {step: "container"}});
    assert.deepEqual(await runCatererTool(actor, "session", {sessionId: "verification"}), {draft: {step: "container"}});
    const [stored] = await db.select().from(catererPreorders).where(eq(catererPreorders.id, first.orderId));
    assert.equal(stored?.items[0]?.unitPrice, menu.price);
    await db.update(catererOrderForms).set({active: false}).where(eq(catererOrderForms.id, form.id));
    await assert.rejects(service.submitPreorder(form.id, {...request, submissionId: randomUUID()}));
    await mkdir("artifacts", {recursive: true});
    await writeFile("artifacts/caterer-verification-labels.html", labels.html);
    console.info("PASS: real database form submission, idempotency, concurrent capacity limits, ownership, acceptance, production math, labels, notification drafts, and session persistence.");
    console.info("No messages or grocery purchases were sent. Shared database unchanged.");
  } finally {await closeDatabaseConnection();}
}

main().catch((error: unknown) => {
  // Never log query parameters, connection strings, or customer records.
  console.error("Caterer branch verification failed:", error instanceof Error ? error.name : "unknown error");
  process.exitCode = 1;
});
