import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, like, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { cateringRequestStates, conversations, messages } from "../db/schema/index.js";
import { DomainError } from "./errors.js";
import { assertConversationCustomer } from "./request-state.js";

/** Each event keeps its own existing structured request row; no schema migration is needed. */
export async function getAgentContext(conversationId: string, customerId: string) {
  await assertConversationCustomer(conversationId, customerId);
  const requests = await db
    .select({ state: cateringRequestStates })
    .from(cateringRequestStates)
    .innerJoin(conversations, eq(conversations.id, cateringRequestStates.conversationId))
    .where(and(
      eq(cateringRequestStates.customerId, customerId),
      eq(conversations.userId, customerId),
      or(
        eq(conversations.id, conversationId),
        like(conversations.externalConversationId, `agent-request:${conversationId}:%`)
      )
    ))
    .orderBy(asc(cateringRequestStates.createdAt), asc(cateringRequestStates.id));
  const states = requests.map(({ state }) => state);
  // Keep the original request numbered first, including when timestamps tie.
  states.sort((a, b) => Number(b.conversationId === conversationId) - Number(a.conversationId === conversationId));
  if (!states.length) throw new DomainError("REQUEST_STATE_NOT_FOUND");
  const active = states.reduce((latest, state) => state.updatedAt > latest.updatedAt ? state : latest);
  const history = await db.select({ sender: messages.sender, content: messages.content })
    .from(messages).where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt), desc(messages.id)).limit(24);
  return { requests: states, activeConversationId: active.conversationId, history: history.reverse() };
}

export async function createAgentRequest(conversationId: string, customerId: string) {
  const context = await getAgentContext(conversationId, customerId);
  if (context.requests.length >= 20) throw new DomainError("REQUEST_LIMIT_REACHED");
  const updatedAt = new Date(Math.max(Date.now(), ...context.requests.map((state) => state.updatedAt.getTime() + 1)));
  return db.transaction(async (tx) => {
    const [conversation] = await tx.insert(conversations).values({
      userId: customerId,
      externalConversationId: `agent-request:${conversationId}:${randomUUID()}`
    }).returning();
    if (!conversation) throw new Error("Request conversation creation failed.");
    const [state] = await tx.insert(cateringRequestStates).values({
      conversationId: conversation.id, customerId, createdAt: updatedAt, updatedAt
    }).returning();
    if (!state) throw new Error("Request state creation failed.");
    return state;
  });
}

export async function activateAgentRequest(conversationId: string, customerId: string, requestConversationId: string) {
  const context = await getAgentContext(conversationId, customerId);
  if (!context.requests.some((state) => state.conversationId === requestConversationId)) {
    throw new DomainError("REQUEST_STATE_NOT_FOUND");
  }
  const updatedAt = new Date(Math.max(Date.now(), ...context.requests.map((state) => state.updatedAt.getTime() + 1)));
  const [state] = await db.update(cateringRequestStates).set({ updatedAt }).where(and(
    eq(cateringRequestStates.conversationId, requestConversationId),
    eq(cateringRequestStates.customerId, customerId)
  )).returning();
  if (!state) throw new DomainError("REQUEST_STATE_NOT_FOUND");
  return state;
}
