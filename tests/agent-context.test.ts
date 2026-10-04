import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const fake = vi.hoisted(() => {
  const results: unknown[][] = [];
  const clauses: unknown[] = [];
  const select = vi.fn(() => {
    const rows = results.shift() ?? [];
    const query: Record<string, unknown> = {};
    Object.assign(query, {
      from: () => query, innerJoin: () => query, orderBy: () => query,
      where: (clause: unknown) => { clauses.push(clause); return query; },
      limit: async () => rows,
      then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve)
    });
    return query;
  });
  return { results, clauses, select };
});
vi.mock("../src/db/index.js", () => ({ db: { select: fake.select } }));

import { getCustomerOrder, getCustomerOrders } from "../src/services/orders.js";
import { getAgentContext } from "../src/services/agent-context.js";
import { customerOrdersSchema } from "../src/validation/index.js";

const customerId = "11000000-0000-4000-8000-000000000006";
const anotherCustomerId = "11000000-0000-4000-8000-000000000007";
const conversationId = "66000000-0000-4000-8000-000000000010";
const childId = "66000000-0000-4000-8000-000000000011";
const orderId = "44000000-0000-4000-8000-000000000010";
const dialect = new PgDialect();
const params = (index: number) => dialect.sqlToQuery(fake.clauses[index] as SQL).params;

beforeEach(() => {
  fake.results.length = 0;
  fake.clauses.length = 0;
  fake.select.mockClear();
});

describe("customer order reads", () => {
  it("rejects an order belonging to another customer before reading its items", async () => {
    fake.results.push([{ id: orderId, customerId: anotherCustomerId }]);
    await expect(getCustomerOrder(orderId, customerId)).rejects.toMatchObject({ code: "UNAUTHORIZED_CUSTOMER" });
    expect(fake.select).toHaveBeenCalledTimes(1);
  });

  it("returns historical quantities and price snapshots with mandatory customer scope", async () => {
    fake.results.push([{ order: { id: orderId, customerId, status: "REQUESTED" }, catererName: "Fictional Kitchen" }]);
    fake.results.push([{ orderId, name: "Fictional Dumplings", quantity: 30, unitPrice: "11.50" }]);
    const result = await getCustomerOrders({ customerId, location: "Detroit, MI" });
    expect(params(0)).toContain(customerId);
    expect(params(0)).toContain("Detroit, MI");
    expect(params(1)).toContain(orderId);
    expect(result.orders[0]?.items[0]).toMatchObject({ quantity: 30, unitPrice: "11.50" });
    expect(result.hasMore).toBe(false);
  });

  it("validates identity and prevents caller-controlled ownership filters", () => {
    expect(customerOrdersSchema.safeParse({ status: "REQUESTED" }).success).toBe(false);
    expect(customerOrdersSchema.safeParse({ customerId, catererId: "anything" }).success).toBe(false);
    expect(customerOrdersSchema.safeParse({ customerId, status: "BOOKED" }).success).toBe(false);
  });

  it("does not fetch items when the customer has no orders", async () => {
    fake.results.push([]);
    await expect(getCustomerOrders({ customerId })).resolves.toEqual({ orders: [], hasMore: false });
    expect(fake.select).toHaveBeenCalledTimes(1);
  });
});

describe("persisted multi-event context", () => {
  it("rejects access to another customer's conversation before loading context", async () => {
    fake.results.push([{ id: conversationId, userId: anotherCustomerId }]);
    await expect(getAgentContext(conversationId, customerId)).rejects.toMatchObject({ code: "UNAUTHORIZED_CUSTOMER" });
    expect(fake.select).toHaveBeenCalledTimes(1);
  });

  it("loads only the root and its customer-owned event requests and keeps the active event", async () => {
    const first = { conversationId, customerId, createdAt: new Date(0), updatedAt: new Date(10), location: "Ann Arbor, MI" };
    const second = { conversationId: childId, customerId, createdAt: new Date(1), updatedAt: new Date(20), location: "Detroit, MI" };
    fake.results.push([{ id: conversationId, userId: customerId }], [{ state: first }, { state: second }],
      [{ sender: "SYSTEM", content: "Latest reply" }, { sender: "CUSTOMER", content: "Two events" }]);
    const context = await getAgentContext(conversationId, customerId);
    expect(context.activeConversationId).toBe(childId);
    expect(context.requests.map((state) => state.location)).toEqual(["Ann Arbor, MI", "Detroit, MI"]);
    expect(params(1)).toContain(customerId);
    expect(params(1)).toContain(`agent-request:${conversationId}:%`);
    expect(params(2)).toEqual([conversationId]);
    expect(context.history[0]?.content).toBe("Two events");
  });
});
