import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const fake = vi.hoisted(() => {
  const results: unknown[][] = [], clauses: unknown[] = [], writes: unknown[] = [], locks: string[] = [];
  const select = vi.fn(() => {
    const rows = results.shift() ?? [];
    const query: Record<string, unknown> = {};
    Object.assign(query, {from: () => query, innerJoin: () => query, orderBy: () => query,
      where: (value: unknown) => {clauses.push(value); return query;},
      for: (value: string) => {locks.push(value); return query;},
      then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve)});
    return query;
  });
  const write = vi.fn(() => {
    const query = {values: (value: unknown) => {writes.push(value); return query;},
      set: (value: unknown) => {writes.push(value); return query;},
      where: (value: unknown) => {clauses.push(value); return query;}, returning: async () => results.shift() ?? []};
    return query;
  });
  const db = {select, insert: write, update: write};
  return {results, clauses, writes, locks, select, write, db, owner: vi.fn()};
});
vi.mock("../src/db/index.js", () => ({db: {...fake.db, transaction: async (fn: (tx: typeof fake.db) => unknown) => fn(fake.db)}}));
vi.mock("../src/services/caterers.js", () => ({getCaterer: fake.owner}));
import { createOrderForm, getOrderFormOptions, previewOrderForm, submitPreorder, changePreorderStatus, productionPlan, draftNotifications, updateNotificationRecipient } from "../src/services/caterer-operations.js";
import { createLabels, createOrderReceipt } from "../src/services/caterer-documents.js";
import { changePreorderStatuses } from "../src/services/caterer-operations.js";

const actor = {catererId: "22000000-0000-4000-8000-000000000001", actorUserId: "11000000-0000-4000-8000-000000000001"};
const id = "99000000-0000-4000-8000-000000000001";
const spec = {menuItemId: id, container: {name: "box", capacity: {amount: "12", unit: "each"}, fill: {amount: "12", unit: "each"}},
  recipe: {name: "Dumplings", yield: {amount: "60", unit: "each"}, ingredients: [{name: "Flour", measure: {amount: "500", unit: "g"}}], allergens: ["wheat"], storageInstructions: "Keep cool"}};
const product = {productSpecId: id, name: "Dumplings", unitPrice: "11.50", container: "box (12 each)", maxPackages: 10};
const form = {id, catererId: actor.catererId, active: true, closesAt: new Date("2099-01-01"), fulfillmentMethod: "DELIVERY", products: [product], minimumOrder: "20.00", deliveryFee: "3.25", fulfillmentDate: "2099-01-02"};
const request = {submissionId: id, customerName: "Demo", customerContact: "demo@example.invalid", deliveryAddress: "Fictional street", items: [{productSpecId: id, quantity: 2}]};
const period = {start: "2099-01-01", end: "2099-01-07"};
const params = (i: number) => new PgDialect().sqlToQuery(fake.clauses[i] as SQL).params;

beforeEach(() => {
  fake.results.length = fake.clauses.length = fake.writes.length = fake.locks.length = 0;
  fake.select.mockClear(); fake.write.mockClear(); fake.owner.mockReset();
  fake.owner.mockResolvedValue({...actor, id: actor.catererId, ownerUserId: actor.actorUserId, active: true, businessName: "Demo Kitchen", fulfillmentMethod: "EITHER"});
});

describe("caterer order forms", () => {
  it.each([
    {configured: "EITHER", supported: ["PICKUP", "DELIVERY"]},
    {configured: "PICKUP", supported: ["PICKUP"]},
    {configured: "DELIVERY", supported: ["DELIVERY"]},
  ])("reads $configured fulfillment options for the authenticated owner without writing", async ({configured, supported}) => {
    fake.owner.mockResolvedValueOnce({ownerUserId: actor.actorUserId, fulfillmentMethod: configured});
    await expect(getOrderFormOptions(actor)).resolves.toEqual({supportedFulfillmentMethods: supported});
    expect(fake.owner).toHaveBeenCalledWith(actor.catererId);
    expect(fake.write).not.toHaveBeenCalled();
  });
  it("does not disclose form options to another owner", async () => {
    fake.owner.mockResolvedValueOnce({ownerUserId: "other", fulfillmentMethod: "DELIVERY"});
    await expect(getOrderFormOptions(actor)).rejects.toMatchObject({code: "UNAUTHORIZED_CATERER"});
    expect(fake.select).not.toHaveBeenCalled();
    expect(fake.write).not.toHaveBeenCalled();
  });
  it("changes a batch under locks and never partially accepts an invalid selection", async () => {
    const second = "99000000-0000-4000-8000-000000000002";
    fake.results.push([{id, status: "REQUESTED"}, {id: second, status: "COMPLETED"}]);
    await expect(changePreorderStatuses(actor, {orderIds: [id, second], status: "ACCEPTED"})).rejects.toMatchObject({code: "INVALID_ORDER_TRANSITION"});
    expect(fake.write).not.toHaveBeenCalled();
    fake.results.push([{id, status: "REQUESTED"}, {id: second, status: "REQUESTED"}], [{id, status: "ACCEPTED"}, {id: second, status: "ACCEPTED"}]);
    expect(await changePreorderStatuses(actor, {orderIds: [id, second], status: "ACCEPTED"})).toHaveLength(2);
    expect(fake.write).toHaveBeenCalledTimes(1);
    expect(fake.locks).toEqual(["update", "update"]);
    expect(params(1)).toEqual([actor.catererId, id, second]);
    expect(params(2)).toEqual([actor.catererId, id, second]);
  });
  it("rejects foreign, missing, duplicate, oversized, and unauthorized batches", async () => {
    const second = "99000000-0000-4000-8000-000000000002";
    fake.results.push([{id, status: "REQUESTED"}]);
    await expect(changePreorderStatuses(actor, {orderIds: [id, second], status: "ACCEPTED"})).rejects.toThrow("Every selected order");
    for (const orderIds of [[], [id, id], Array(51).fill(id)]) {
      await expect(changePreorderStatuses(actor, {orderIds, status: "ACCEPTED"})).rejects.toThrow();
    }
    fake.owner.mockResolvedValueOnce({ownerUserId: "other"});
    await expect(changePreorderStatuses(actor, {orderIds: [id], status: "ACCEPTED"})).rejects.toMatchObject({code: "UNAUTHORIZED_CATERER"});
    expect(fake.select).toHaveBeenCalledTimes(1);
    expect(fake.write).not.toHaveBeenCalled();
  });
  const formInput = {title: "Saturday dumplings", fulfillmentDate: "2099-01-02", closesAt: "2099-01-01T12:00:00Z",
    fulfillmentMethod: "PICKUP", fulfillmentInstructions: "Fictional hall", products: [{productSpecId: id, maxPackages: 10}]};
  it.each([
    {configured: "DELIVERY", requested: "PICKUP", correction: "Choose delivery for this form"},
    {configured: "PICKUP", requested: "DELIVERY", correction: "Choose pickup for this form"},
  ])("rejects $requested on a $configured business before reading products or inserting a form", async ({configured, requested, correction}) => {
    fake.owner.mockResolvedValue({ownerUserId: actor.actorUserId, active: true, fulfillmentMethod: configured});
    const input = {...formInput, fulfillmentMethod: requested};
    await expect(previewOrderForm(actor, input)).rejects.toThrow(correction);
    await expect(createOrderForm(actor, input)).rejects.toThrow(correction);
    expect(fake.select).not.toHaveBeenCalled();
    expect(fake.write).not.toHaveBeenCalled();
  });
  it("previews actual menu prices without publishing and binds publication to the reviewed price", async () => {
    const definition = {definition: {id, productName: "Dumplings", spec}, price: "11.50", active: true};
    fake.results.push([definition]);
    expect(await previewOrderForm(actor, formInput)).toMatchObject({products: [product], deliveryFee: "0.00"});
    expect(fake.write).not.toHaveBeenCalled();
    const reviewed = {...formInput, products: [{...formInput.products[0], expectedUnitPrice: "11.50"}]};
    fake.results.push([{...definition, price: "12.00"}]);
    await expect(createOrderForm(actor, reviewed)).rejects.toThrow("menu price changed");
    expect(fake.write).not.toHaveBeenCalled();
    fake.results.push([definition], [{id}]);
    await createOrderForm(actor, reviewed);
    expect(fake.writes[0]).toMatchObject({products: [product]});
    expect(JSON.stringify(fake.writes[0])).not.toContain("expectedUnitPrice");
  });
  it("enforces ownership, active products, supported fulfillment, dates and price validation in previews", async () => {
    fake.owner.mockResolvedValueOnce({ownerUserId: "other"});
    await expect(previewOrderForm(actor, formInput)).rejects.toMatchObject({code: "UNAUTHORIZED_CATERER"});
    fake.results.push([]);
    await expect(previewOrderForm(actor, formInput)).rejects.toThrow("owned by this caterer");
    fake.owner.mockResolvedValueOnce({ownerUserId: actor.actorUserId, active: true, fulfillmentMethod: "DELIVERY"});
    await expect(previewOrderForm(actor, formInput)).rejects.toThrow("does not support");
    await expect(previewOrderForm(actor, {...formInput, closesAt: "2020-01-01T12:00:00Z"})).rejects.toThrow("future");
    await expect(previewOrderForm(actor, {...formInput, products: [{...formInput.products[0], unitPrice: "0.01"}]})).rejects.toThrow();
    expect(fake.write).not.toHaveBeenCalled();
  });
  it("rejects another owner before reading or writing orders", async () => {
    fake.owner.mockResolvedValue({ownerUserId: "other"});
    await expect(changePreorderStatus(actor, {orderId: id, status: "ACCEPTED"})).rejects.toMatchObject({code: "UNAUTHORIZED_CATERER"});
    expect(fake.select).not.toHaveBeenCalled(); expect(fake.write).not.toHaveBeenCalled();
  });
  it("snapshots the database price and rejects unavailable product definitions", async () => {
    const input = {title: "Demo", fulfillmentDate: "2099-01-02", closesAt: "2099-01-01T12:00:00Z", fulfillmentMethod: "PICKUP", fulfillmentInstructions: "Demo location", products: [{productSpecId: id, maxPackages: 10}]};
    fake.results.push([{definition: {id, productName: "Dumplings", spec}, price: "11.50", active: true}], [{id}]);
    await createOrderForm(actor, input);
    expect(fake.writes[0]).toMatchObject({products: [product], deliveryFee: "0.00"});
    fake.results.push([]);
    await expect(createOrderForm(actor, input)).rejects.toThrow("Every product");
  });
  it("locks reservations and calculates exact totals with the saved price and fee", async () => {
    fake.results.push([form], [], [{active: true}], [], [{id, status: "REQUESTED", total: "26.25"}]);
    await expect(submitPreorder(id, request)).resolves.toEqual({orderId: id, status: "REQUESTED", total: "26.25"});
    expect(fake.locks).toEqual(["update"]);
    expect(fake.writes[0]).toMatchObject({total: "26.25", status: "REQUESTED", items: [{unitPrice: "11.50", quantity: 2}]});
  });
  it("compares the closing date in the supplied time zone", async () => {
    fake.results.push([{definition: {id, productName: "Dumplings", spec}, price: "11.50", active: true}], [{id}]);
    await expect(createOrderForm(actor, {title: "Demo", fulfillmentDate: "2099-01-02", closesAt: "2099-01-02T23:00:00-04:00",
      fulfillmentMethod: "DELIVERY", fulfillmentInstructions: "Demo", products: [{productSpecId: id, maxPackages: 10}]})).resolves.toEqual({id});
  });
  it("makes a repeated form submission idempotent", async () => {
    fake.results.push([form], [{id, status: "ACCEPTED", total: "26.25"}]);
    expect((await submitPreorder(id, request)).status).toBe("ACCEPTED");
    expect(fake.write).not.toHaveBeenCalled();
  });
  it("enforces package limits and counts pending reservations", async () => {
    fake.results.push([form], [], [{active: true}], [{items: [{productSpecId: id, quantity: 9}]}]);
    await expect(submitPreorder(id, request)).rejects.toThrow("enough packages");
    expect(params(3)).toContain("DECLINED"); expect(params(3)).toContain("CANCELLED");
    expect(fake.write).not.toHaveBeenCalled();
  });
  it("enforces minimum food subtotal, delivery address, and active businesses", async () => {
    fake.results.push([form], [], [{active: true}], []);
    await expect(submitPreorder(id, {...request, items: [{productSpecId: id, quantity: 1}]})).rejects.toThrow("at least $20.00");
    fake.results.push([form], [], [{active: true}]);
    await expect(submitPreorder(id, {...request, deliveryAddress: ""})).rejects.toThrow("address");
    fake.results.push([form], [], [{active: false}]);
    await expect(submitPreorder(id, request)).rejects.toThrow("not taking orders");
  });
  it("restricts status changes to owned orders and enforces the state machine", async () => {
    fake.results.push([]);
    await expect(changePreorderStatus(actor, {orderId: id, status: "ACCEPTED"})).rejects.toThrow("not found");
    expect(params(0)).toContain(actor.catererId);
    fake.results.push([{id, status: "COMPLETED"}]);
    await expect(changePreorderStatus(actor, {orderId: id, status: "ACCEPTED"})).rejects.toMatchObject({code: "INVALID_ORDER_TRANSITION"});
    expect(fake.write).not.toHaveBeenCalled();
  });
});

describe("order receipts", () => {
  const order = {id, customerName: "Fictional Buyer", fulfillmentDate: period.start,
    status: "REQUESTED", items: [{...product, quantity: 2}], total: "26.25"};

  it("itemizes saved prices, containers and the historical delivery fee without changing the order", async () => {
    fake.results.push([order]);
    const receipt = await createOrderReceipt(actor, {orderId: id});
    expect(receipt).toMatchObject({orderId: id, documentKind: "receipt"});
    for (const detail of ["Demo Kitchen", "Fictional Buyer", id, period.start, "Order status: REQUESTED",
      "2 × Dumplings", "box (12 each)", "$11.50 each = $23.00", "Subtotal: $23.00", "Delivery fee: $3.25", "Total: $26.25",
      "does not confirm payment"]) expect(receipt.text).toContain(detail);
    expect(receipt.html).toContain("$26.25");
    expect(receipt.html).toContain("does not confirm payment");
    expect(fake.select).toHaveBeenCalledTimes(1);
    expect(params(0)).toEqual([id, actor.catererId]);
    expect(fake.write).not.toHaveBeenCalled();
  });
  it("uses integer cents and supports cancelled orders without implying payment", async () => {
    fake.results.push([{...order, status: "CANCELLED", items: [{...product, unitPrice: "0.10", quantity: 3}], total: "0.30"}]);
    const receipt = await createOrderReceipt(actor, {orderId: id});
    expect(receipt.text).toContain("Order status: CANCELLED");
    expect(receipt.text).toContain("$0.10 each = $0.30");
    expect(receipt.text).toContain("Delivery fee: $0.00");
    expect(receipt.text).toContain("Total: $0.30");
  });
  it("escapes stored names and containers in printable receipts", async () => {
    fake.owner.mockResolvedValueOnce({ownerUserId: actor.actorUserId, businessName: "<b>Kitchen</b>"});
    fake.results.push([{...order, customerName: "<script>bad</script>",
      items: [{...product, name: "<img src=x onerror=alert(1)>", container: "<b>box</b>", quantity: 2}]}]);
    const receipt = await createOrderReceipt(actor, {orderId: id});
    expect(receipt.html).toContain("&lt;script&gt;bad&lt;/script&gt;");
    expect(receipt.html).toContain("&lt;b&gt;Kitchen&lt;/b&gt;");
    expect(receipt.html).toContain("&lt;b&gt;box&lt;/b&gt;");
    expect(receipt.html).toContain("&lt;img");
    expect(receipt.html).not.toMatch(/<script>|<img/);
  });
  it("rejects another owner, foreign or missing orders, and supplied totals", async () => {
    fake.owner.mockResolvedValueOnce({ownerUserId: "other"});
    await expect(createOrderReceipt(actor, {orderId: id})).rejects.toMatchObject({code: "UNAUTHORIZED_CATERER"});
    expect(fake.select).not.toHaveBeenCalled();
    fake.results.push([]);
    await expect(createOrderReceipt(actor, {orderId: id})).rejects.toThrow("not found for this caterer");
    expect(params(0)).toEqual([id, actor.catererId]);
    await expect(createOrderReceipt(actor, {orderId: id, total: "0.01"})).rejects.toThrow();
    await expect(createOrderReceipt(actor, {orderId: "invalid"})).rejects.toThrow();
    expect(fake.select).toHaveBeenCalledTimes(1);
    expect(fake.write).not.toHaveBeenCalled();
  });
  it("rejects inconsistent stored totals instead of inventing a discount", async () => {
    fake.results.push([{...order, total: "1.00"}]);
    await expect(createOrderReceipt(actor, {orderId: id})).rejects.toThrow("saved order total");
    expect(fake.write).not.toHaveBeenCalled();
  });
});

describe("production and distribution", () => {
  it("plans only the selected owned order and rounds its recipe to whole batches", async () => {
    fake.results.push([{id, status: "ACCEPTED", fulfillmentDate: period.start,
      items: [{...product, quantity: 2}]}], [{id, spec}]);
    const plan = await productionPlan(actor, {orderId: id});
    expect(plan).toMatchObject({orderId: id, period: {start: period.start, end: period.start},
      acceptedOrders: 1, pendingRequests: 0, products: [{packages: 2, batches: 1}],
      ingredients: [{name: "Flour", amount: "500", unit: "g"}]});
    expect(params(0)).toEqual([id, actor.catererId]);
    expect(fake.write).not.toHaveBeenCalled();
  });
  it.each(["REQUESTED", "DECLINED", "CANCELLED", "COMPLETED", "DRAFT"])("rejects a selected %s order before calculating ingredients", async status => {
    fake.results.push([{id, status}]);
    await expect(productionPlan(actor, {orderId: id})).rejects.toThrow("must be accepted");
    expect(fake.select).toHaveBeenCalledTimes(1);
    expect(fake.write).not.toHaveBeenCalled();
  });
  it("does not turn a missing or foreign order into a date-wide plan", async () => {
    fake.results.push([]);
    await expect(productionPlan(actor, {orderId: id})).rejects.toThrow("not found for this caterer");
    expect(params(0)).toEqual([id, actor.catererId]);
    expect(fake.select).toHaveBeenCalledTimes(1);
    expect(fake.write).not.toHaveBeenCalled();
  });
  it("rejects another owner and invalid or ambiguous production selections", async () => {
    fake.owner.mockResolvedValueOnce({ownerUserId: "other"});
    await expect(productionPlan(actor, {orderId: id})).rejects.toMatchObject({code: "UNAUTHORIZED_CATERER"});
    for (const input of [{orderId: "invalid"}, {...period, orderId: id}, {orderId: id, total: "1.00"}]) {
      await expect(productionPlan(actor, input)).rejects.toThrow();
    }
    expect(fake.select).not.toHaveBeenCalled();
    expect(fake.write).not.toHaveBeenCalled();
  });
  it("aggregates only accepted orders; pending and cancelled work does not increase ingredients", async () => {
    const item = {...product, quantity: 3};
    fake.results.push([{status: "ACCEPTED", items: [item]}, {status: "ACCEPTED", items: [item]}, {status: "REQUESTED", items: [item]}, {status: "CANCELLED", items: [item]}], [{id, spec}]);
    const plan = await productionPlan(actor, period);
    expect(plan).toMatchObject({acceptedOrders: 2, pendingRequests: 1, products: [{packages: 6, batches: 2}], ingredients: [{amount: "1000"}]});
    expect(params(0)).toContain(actor.catererId);
  });
  it("prints one escaped label per package, with saved allergens and storage instructions", async () => {
    fake.results.push([{id, customerName: "<script>bad</script>", fulfillmentDate: period.start, status: "ACCEPTED", items: [{...product, quantity: 2}]}], [{id, spec}]);
    const result = await createLabels(actor, period);
    expect(result.labelCount).toBe(2);
    expect(result.html).toContain("&lt;script&gt;bad&lt;/script&gt;");
    expect(result.html).not.toContain("<script>");
    expect(result.html).toContain("wheat"); expect(result.html).toContain("Keep cool");
    expect(result.html).not.toContain("Use by:");
  });
  it("refuses notification drafts for unaccepted or foreign orders", async () => {
    fake.results.push([{id, status: "REQUESTED"}]);
    await expect(draftNotifications(actor, {orderIds: [id], deliveryWindow: "2pm"})).rejects.toThrow("accepted or completed");
    fake.results.push([]);
    await expect(draftNotifications(actor, {orderIds: [id], deliveryWindow: "2pm"})).rejects.toThrow("belonging");
    expect(fake.write).not.toHaveBeenCalled();
  });
  it("normalizes a draft phone number and atomically restricts editing to the owner's unsent draft", async () => {
    fake.results.push([{id, recipient: "+12025550143", body: "Delivery at 2pm", status: "DRAFT"}]);
    const result = await updateNotificationRecipient(actor, {notificationId: id, recipient: "+1 (202) 555-0143"});
    expect(result).toMatchObject({recipient: "+12025550143", body: "Delivery at 2pm", status: "DRAFT"});
    expect(params(0)).toEqual([id, actor.catererId, "DRAFT"]);
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]).toEqual({recipient: "+12025550143", updatedAt: expect.any(Date)});
  });
  it.each(["2025550143", "+0123456789", "+123", "+1234567890123456", "person@example.invalid", "not a number"])("rejects invalid phone %s before any write", async recipient => {
    await expect(updateNotificationRecipient(actor, {notificationId: id, recipient})).rejects.toThrow("country code");
    expect(fake.write).not.toHaveBeenCalled();
  });
  it("rejects unauthorized owners and missing, foreign, or already claimed drafts", async () => {
    fake.owner.mockResolvedValueOnce({ownerUserId: "other"});
    await expect(updateNotificationRecipient(actor, {notificationId: id, recipient: "+12025550143"})).rejects.toMatchObject({code: "UNAUTHORIZED_CATERER"});
    expect(fake.write).not.toHaveBeenCalled();
    fake.results.push([]);
    await expect(updateNotificationRecipient(actor, {notificationId: id, recipient: "+12025550143"})).rejects.toThrow("unsent notification drafts");
    expect(params(0)).toContain("DRAFT");
  });
});
