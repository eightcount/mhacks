import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => {
  const clauses: unknown[] = [], values: unknown[] = [], results: unknown[][] = [];
  const query = {set: (value: unknown) => {values.push(value); return query;}, where: (clause: unknown) => {clauses.push(clause); return query;},
    returning: async () => results.shift() ?? []};
  return {clauses, values, results, update: vi.fn(() => query), authorize: vi.fn(), fetch: vi.fn()};
});
vi.mock("../src/db/index.js", () => ({db: {update: fake.update}}));
vi.mock("../src/services/caterer-operations.js", () => ({authorizeCaterer: fake.authorize}));
import { sendCatererNotification } from "../src/messaging/caterer-notifications.js";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
const id = "99000000-0000-4000-8000-000000000001";
const actor = {catererId: "owner-caterer", actorUserId: "owner"};
beforeEach(() => {
  fake.clauses.length = fake.values.length = fake.results.length = 0;
  fake.update.mockClear(); fake.fetch.mockReset(); fake.authorize.mockResolvedValue({});
  vi.stubGlobal("fetch", fake.fetch); vi.stubEnv("CATERER_NOTIFICATION_WEBHOOK_URL", "");
});
afterEach(() => {vi.unstubAllGlobals(); vi.unstubAllEnvs();});
describe("notification delivery boundary", () => {
  it("requires explicit confirmation and preserves drafts without a transport", async () => {
    await expect(sendCatererNotification(actor, {notificationId: id})).rejects.toThrow();
    expect(await sendCatererNotification(actor, {notificationId: id, confirm: true})).toMatchObject({status: "NOT_CONNECTED"});
    expect(fake.update).not.toHaveBeenCalled(); expect(fake.fetch).not.toHaveBeenCalled();
  });
  it("claims only the owner's draft and requires a provider delivery receipt", async () => {
    vi.stubEnv("CATERER_NOTIFICATION_WEBHOOK_URL", "https://messaging.example.invalid/send");
    fake.results.push([{id, recipient: "demo@example.invalid", body: "Demo delivery window"}]);
    fake.fetch.mockResolvedValue(new Response(JSON.stringify({delivered: true, messageId: "demo-receipt"})));
    expect(await sendCatererNotification(actor, {notificationId: id, confirm: true})).toMatchObject({status: "SENT"});
    const params = new PgDialect().sqlToQuery(fake.clauses[0] as SQL).params;
    expect(params).toContain(actor.catererId); expect(params).toContain("DRAFT");
    expect(fake.fetch.mock.calls[0]?.[1].headers["Idempotency-Key"]).toBe(id);
  });
  it("does not resend already claimed drafts or report delivery on an empty 200 response", async () => {
    vi.stubEnv("CATERER_NOTIFICATION_WEBHOOK_URL", "https://messaging.example.invalid/send");
    fake.results.push([]);
    await expect(sendCatererNotification(actor, {notificationId: id, confirm: true})).rejects.toThrow("unsent draft");
    expect(fake.fetch).not.toHaveBeenCalled();
    fake.results.push([{id, recipient: "demo@example.invalid", body: "Demo"}]);
    fake.fetch.mockResolvedValue(new Response("{}"));
    expect(await sendCatererNotification(actor, {notificationId: id, confirm: true})).toMatchObject({status: "FAILED"});
    expect(fake.values.at(-1)).toMatchObject({status: "FAILED"});
  });
  it("reports provider submission separately from confirmed delivery", async () => {
    vi.stubEnv("CATERER_NOTIFICATION_WEBHOOK_URL", "https://messaging.example.invalid/send");
    fake.results.push([{id, recipient: "demo@example.invalid", body: "Demo"}]);
    fake.fetch.mockResolvedValue(new Response(JSON.stringify({accepted: true, messageId: "submitted"})));
    const result = await sendCatererNotification(actor, {notificationId: id, confirm: true});
    expect(result.status).toBe("SENT"); expect(result.message).toContain("not yet confirmed");
  });
});
