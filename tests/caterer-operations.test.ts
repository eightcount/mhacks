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
import { createOrderForm, submitPreorder, changePreorderStatus, productionPlan, draftNotifications } from "../src/services/caterer-operations.js";
import { createLabels } from "../src/services/caterer-documents.js";

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

describe("production and distribution", () => {
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
});
