import { describe, expect, it, vi } from "vitest";
import { normalizeIMessageHandle, getPhotonConfig } from "../src/messaging/photon-config.js";
import { routePhotonMessage, type PhotonInbound } from "../src/messaging/photon-router.js";
import { dispatchPhotonNotification } from "../src/messaging/photon-notifications.js";
import { isPublicCatererRoute } from "../src/messaging/photon-public.js";
import type { AgentReply } from "../src/validation/photon.js";
import { imessage, iMessageSpaceSchema } from "../src/messaging/photon-sdk.js";

const owner = "owner@example.invalid";
const incoming: PhotonInbound = {id: "event-one", chatId: "chat-one", line: "test-line", sender: owner, text: "new form", direction: "inbound", platform: "imessage", chatType: "dm", timestamp: new Date(2000)};
function harness() {
  const receipts = new Map<string, {status: string; reply?: AgentReply}>();
  const agent = vi.fn(async (_session: string, _text: string): Promise<AgentReply> => ({text: "Choose your products"}));
  const send = vi.fn(async (_chat: string, _text: string) => {});
  const tool = vi.fn(async (_name: string, input: unknown) => {
    const {key, action, reply} = input as {key: string; action: string; reply?: AgentReply};
    const prior = receipts.get(key);
    if (action === "claim") {
      if (prior) return {claimed: false, ...prior};
      receipts.set(key, {status: "PROCESSING"}); return {claimed: true, status: "PROCESSING"};
    }
    const expected: Record<string, string> = {ready: "PROCESSING", dispatch: "READY", sent: "SENDING", failed: "SENDING"};
    if (!prior || prior.status !== expected[action]) return {claimed: false, status: prior?.status || "FAILED"};
    const next = action === "ready" ? {status: "READY", ...(reply ? {reply} : {})} : {...prior, status: {dispatch: "SENDING", sent: "SENT", failed: "FAILED"}[action] || "FAILED"};
    receipts.set(key, next); return {claimed: true, ...next};
  });
  return {receipts, agent, send, tool, owner, projectId: "fictional-project", startedAt: 1000};
}
describe("Photon owner routing", () => {
  it("delivers only text when an older agent includes interactive card metadata", async () => {
    const deps = harness();
    const card = {id: "99000000-0000-4000-8000-000000000001", title: "Manage orders", fields: [], actions: [{id: "accept" as const, label: "Accept selected"}]};
    deps.agent.mockResolvedValue({text: "Choose orders", card});
    expect(await routePhotonMessage(incoming, deps)).toBe("SENT");
    expect(deps.send).toHaveBeenCalledWith(incoming.chatId, "Choose orders");
    expect(deps.tool.mock.calls.every(([name]) => name === "photon_receipt")).toBe(true);
    expect(await routePhotonMessage(incoming, deps)).toBe("DUPLICATE");
    expect(deps.send).toHaveBeenCalledTimes(1);
  });
  it("recovers a cached card reply as text without repeating the agent action", async () => {
    const deps = harness();
    const card = {id: "99000000-0000-4000-8000-000000000001", title: "Manage orders", fields: [], actions: [{id: "accept" as const, label: "Accept selected"}]};
    await routePhotonMessage(incoming, deps);
    deps.receipts.set([...deps.receipts.keys()][0]!, {status: "READY", reply: {text: "Choose orders", card}});
    deps.agent.mockClear(); deps.send.mockClear(); deps.tool.mockClear();
    expect(await routePhotonMessage(incoming, deps)).toBe("SENT");
    expect(deps.send).toHaveBeenCalledWith(incoming.chatId, "Choose orders");
    expect(deps.tool.mock.calls.every(([name]) => name === "photon_receipt")).toBe(true);
    expect(await routePhotonMessage(incoming, deps)).toBe("DUPLICATE");
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(deps.agent).not.toHaveBeenCalled();
  });
  it.each([
    {sender: "stranger@example.invalid"}, {sender: ""}, {direction: "outbound"},
    {chatType: "group"}, {platform: "sms"}, {timestamp: new Date(999)},
    {timestamp: new Date("invalid")}, {text: "  "}, {id: ""}, {chatId: ""}
  ])("ignores unauthorized, historical, or unsupported input: %j", async change => {
    const deps = harness();
    expect(await routePhotonMessage({...incoming, ...change}, deps)).toBe("IGNORED");
    expect(deps.agent).not.toHaveBeenCalled(); expect(deps.tool).not.toHaveBeenCalled(); expect(deps.send).not.toHaveBeenCalled();
  });
  it("deduplicates repeated events, including a competing processor", async () => {
    const deps = harness();
    await Promise.all([routePhotonMessage(incoming, deps), routePhotonMessage(incoming, {...deps})]);
    expect(deps.agent).toHaveBeenCalledTimes(1); expect(deps.send).toHaveBeenCalledTimes(1);
    expect(await routePhotonMessage(incoming, {...deps})).toBe("DUPLICATE");
  });
  it("keeps a session across messages and isolates separate chats and lines", async () => {
    const deps = harness();
    for (const change of [{}, {id: "two"}, {id: "three", chatId: "other"}, {id: "four", line: "other-line"}]) await routePhotonMessage({...incoming, ...change}, deps);
    const sessions = deps.agent.mock.calls.map(call => call[0]);
    expect(sessions[0]).toMatch(/^photon-chat:[a-f0-9]{64}$/);
    expect(sessions[0]).toBe(sessions[1]); expect(sessions[2]).not.toBe(sessions[0]); expect(sessions[3]).not.toBe(sessions[0]);
    expect(sessions[0]).not.toContain(owner);
  });
  it("recovers a cached unsent reply without repeating the agent action", async () => {
    const deps = harness();
    await routePhotonMessage(incoming, deps);
    const key = [...deps.receipts.keys()][0]!;
    deps.receipts.set(key, {status: "READY", reply: {text: "Saved reply"}});
    deps.agent.mockClear(); deps.send.mockClear();
    expect(await routePhotonMessage(incoming, deps)).toBe("SENT");
    expect(deps.agent).not.toHaveBeenCalled(); expect(deps.send).toHaveBeenCalledWith("chat-one", "Saved reply");
  });
  it.each(["PROCESSING", "SENDING", "FAILED"])("does not retry an uncertain %s action", async status => {
    const deps = harness(); await routePhotonMessage(incoming, deps);
    deps.receipts.set([...deps.receipts.keys()][0]!, {status}); deps.agent.mockClear(); deps.send.mockClear();
    expect(await routePhotonMessage(incoming, deps)).toBe("DUPLICATE");
    expect(deps.agent).not.toHaveBeenCalled(); expect(deps.send).not.toHaveBeenCalled();
  });
  it("does not resend after a provider error", async () => {
    const deps = harness(); deps.send.mockRejectedValueOnce(new Error("network"));
    expect(await routePhotonMessage(incoming, deps)).toBe("FAILED");
    expect(await routePhotonMessage(incoming, deps)).toBe("DUPLICATE"); expect(deps.send).toHaveBeenCalledTimes(1);
  });
  it("splits long replies without breaking emoji", async () => {
    const deps = harness(); const text = "🥟".repeat(5000); deps.agent.mockResolvedValue({text});
    await routePhotonMessage(incoming, deps);
    expect(deps.send.mock.calls.map(call => call[1]).join("")).toBe(text);
    expect(deps.send.mock.calls).toHaveLength(2);
  });
  it("redacts internal exceptions", async () => {
    const deps = harness(); deps.agent.mockRejectedValue(new Error("private connection details"));
    await routePhotonMessage(incoming, deps);
    expect(deps.send.mock.calls[0]?.[1]).toContain("check whether it was saved");
    expect(deps.send.mock.calls[0]?.[1]).not.toContain("private connection");
  });
  it("delivers a grocery document link with its demo label and deduplicates it", async () => {
    const deps = harness();
    deps.agent.mockResolvedValue({text: "DEMO ONLY — no order placed.", html: "<p>Sample basket</p>", documentKind: "grocery_demo"});
    const receiptTool = deps.tool;
    const documentUrl = "https://forms.example.invalid/documents/demo";
    const routed = {...deps, tool: async (name: string, input: unknown) => ({...await receiptTool(name, input), documentUrl})};
    expect(await routePhotonMessage({...incoming, text: "order ingredients"}, routed)).toBe("SENT");
    expect(deps.send.mock.calls[0]?.[1]).toContain(`View your demo grocery basket: ${documentUrl}`);
    expect(deps.send.mock.calls[0]?.[1]).not.toContain("Print your labels");
    expect(await routePhotonMessage({...incoming, text: "order ingredients"}, routed)).toBe("DUPLICATE");
    expect(deps.agent).toHaveBeenCalledTimes(1);
  });
  it.each([true, false])("delivers itemized receipt text with optional printable link: %s", async hasLink => {
    const deps = harness();
    const text = "Order receipt\nTotal: $26.25\nPayment not recorded.";
    deps.agent.mockResolvedValue({text, html: "<h1>Order receipt</h1>", documentKind: "receipt"});
    const receiptTool = deps.tool;
    const documentUrl = "https://forms.example.invalid/documents/demo";
    const routed = {...deps, tool: async (name: string, input: unknown) => ({...await receiptTool(name, input), ...(hasLink ? {documentUrl} : {})})};
    expect(await routePhotonMessage({...incoming, text: "receipt 1"}, routed)).toBe("SENT");
    const response = deps.send.mock.calls[0]?.[1];
    expect(response).toContain(text);
    expect(response).not.toContain("Print your labels");
    if (hasLink) expect(response).toContain(`View or print your receipt: ${documentUrl}`);
    else expect(response).toContain("local caterer CLI");
    expect(await routePhotonMessage({...incoming, text: "receipt 1"}, routed)).toBe("DUPLICATE");
    expect(deps.send).toHaveBeenCalledTimes(1);
  });
});

describe("Photon notification boundary", () => {
  const saved = {id: "99000000-0000-4000-8000-000000000001", recipient: "buyer@example.invalid", text: "Pickup tomorrow"};
  function notificationHarness() {
    const deps = harness(); const receiptTool = deps.tool;
    const tool = vi.fn(async (name: string, input: unknown) => name === "photon_notification" ? saved : receiptTool(name, input));
    return {...deps, tool, send: vi.fn(async (_recipient: string, _text: string) => "provider-receipt")};
  }
  it("sends only the exact saved, approved draft and deduplicates across workers", async () => {
    const deps = notificationHarness();
    expect(await dispatchPhotonNotification(saved, saved.id, deps)).toEqual({accepted: true, messageId: "provider-receipt"});
    await expect(dispatchPhotonNotification(saved, saved.id, {...deps})).rejects.toThrow("already attempted");
    expect(deps.send).toHaveBeenCalledExactlyOnceWith(saved.recipient, saved.text);
  });
  it("rejects forged recipients, text, or missing idempotency key", async () => {
    const deps = notificationHarness();
    await expect(dispatchPhotonNotification({...saved, recipient: "other@example.invalid"}, saved.id, deps)).rejects.toThrow();
    await expect(dispatchPhotonNotification({...saved, text: "changed"}, saved.id, deps)).rejects.toThrow();
    await expect(dispatchPhotonNotification(saved, undefined, deps)).rejects.toThrow();
    expect(deps.send).not.toHaveBeenCalled();
  });
  it("preserves an uncertain send across restart", async () => {
    const deps = notificationHarness(); deps.send.mockRejectedValueOnce(new Error("timeout"));
    await expect(dispatchPhotonNotification(saved, saved.id, deps)).rejects.toThrow();
    await expect(dispatchPhotonNotification(saved, saved.id, {...deps})).rejects.toThrow("already attempted");
    expect(deps.send).toHaveBeenCalledTimes(1);
  });
});

describe("configuration and public routes", () => {
  it("normalizes handles without guessing a phone country", () => {
    expect(normalizeIMessageHandle(" +1 (202) 555-0143 ")).toBe("+12025550143");
    expect(normalizeIMessageHandle("OWNER@EXAMPLE.INVALID")).toBe(owner);
    expect(normalizeIMessageHandle("2025550143")).toBeUndefined();
    expect(() => getPhotonConfig({})).toThrow("PROJECT_ID");
  });
  it("loads the pinned provider config at runtime", () => {
    expect(imessage.config().__name).toBe("imessage");
    expect(iMessageSpaceSchema.safeParse({type: "dm", phone: "test-line"}).success).toBe(true);
  });
  it("exposes only order forms and signed document reads", () => {
    const form = "/forms/99000000-0000-4000-8000-000000000001";
    expect(isPublicCatererRoute("GET", form)).toBe(true); expect(isPublicCatererRoute("POST", form)).toBe(true);
    expect(isPublicCatererRoute("GET", `/documents/${"a".repeat(64)}`)).toBe(true);
    for (const path of ["/tools/menu", "/caterer/message", "/health", "/forms/../tools/menu", "/forms/x", "/notifications/send"]) expect(isPublicCatererRoute("POST", path)).toBe(false);
    expect(isPublicCatererRoute("DELETE", form)).toBe(false);
    expect(isPublicCatererRoute("POST", `/documents/${"a".repeat(64)}`)).toBe(false);
    const card = "/cards/99000000-0000-4000-8000-000000000001";
    expect(isPublicCatererRoute("GET", card)).toBe(true);
    expect(isPublicCatererRoute("POST", card)).toBe(true);
    expect(isPublicCatererRoute("DELETE", card)).toBe(false);
    expect(isPublicCatererRoute("POST", "/cards/../tools/change_orders")).toBe(false);
  });
});
