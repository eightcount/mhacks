import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  cateringRequestStates,
  caterers,
  conversations,
  messages,
  orders,
  users
} from "../db/schema/index.js";
import type { CateringRequestState } from "../types/domain.js";
import {
  appendAgentMessageSchema,
  createAgentSessionSchema,
  requestStatePatchSchema,
  type AppendAgentMessageInput,
  type CreateAgentSessionInput,
  type RequestStatePatchInput
} from "../validation/index.js";
import { DomainError } from "./errors.js";
import { centsToMoney, moneyToCents } from "./money.js";

function mergeTerms(existing: string[], additions: string[]): string[] {
  const merged = new Map<string, string>();
  for (const value of [...existing, ...additions]) {
    const normalized = value.trim().toLocaleLowerCase();
    if (!merged.has(normalized)) merged.set(normalized, value.trim());
  }
  return [...merged.values()];
}

async function assertConversationCustomer(
  conversationId: string,
  customerId: string
): Promise<void> {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!conversation) {
    throw new DomainError("CONVERSATION_NOT_FOUND");
  }
  if (conversation.userId !== customerId) {
    throw new DomainError("UNAUTHORIZED_CUSTOMER");
  }
}

async function getStateOrThrow(conversationId: string): Promise<CateringRequestState> {
  const [state] = await db
    .select()
    .from(cateringRequestStates)
    .where(eq(cateringRequestStates.conversationId, conversationId))
    .limit(1);
  if (!state) {
    throw new DomainError("REQUEST_STATE_NOT_FOUND");
  }
  return state;
}

export async function createAgentSession(
  input: CreateAgentSessionInput
): Promise<CateringRequestState> {
  const parsed = createAgentSessionSchema.parse(input);
  const [customer] = await db
    .select()
    .from(users)
    .where(eq(users.id, parsed.customerId))
    .limit(1);
  if (!customer || customer.role !== "CUSTOMER") {
    throw new DomainError("CUSTOMER_NOT_FOUND");
  }

  const [existingConversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.externalConversationId, parsed.externalConversationId))
    .limit(1);
  const conversation = existingConversation
    ? existingConversation
    : (
        await db
          .insert(conversations)
          .values({
            userId: parsed.customerId,
            externalConversationId: parsed.externalConversationId
          })
          .returning()
      )[0];

  if (!conversation) {
    throw new Error("Conversation creation did not return a record.");
  }
  if (conversation.userId !== parsed.customerId) {
    throw new DomainError("UNAUTHORIZED_CUSTOMER");
  }

  const [existingState] = await db
    .select()
    .from(cateringRequestStates)
    .where(eq(cateringRequestStates.conversationId, conversation.id))
    .limit(1);
  if (existingState) return existingState;

  const [state] = await db
    .insert(cateringRequestStates)
    .values({ conversationId: conversation.id, customerId: parsed.customerId })
    .onConflictDoNothing({ target: cateringRequestStates.conversationId })
    .returning();
  return state ?? getStateOrThrow(conversation.id);
}

export async function getRequestState(
  conversationId: string,
  customerId: string
): Promise<CateringRequestState> {
  await assertConversationCustomer(conversationId, customerId);
  return getStateOrThrow(conversationId);
}

export async function updateRequestState(
  conversationId: string,
  customerId: string,
  input: RequestStatePatchInput
): Promise<CateringRequestState> {
  const patch = requestStatePatchSchema.parse(input);
  await assertConversationCustomer(conversationId, customerId);
  const current = await getStateOrThrow(conversationId);

  if (patch.selectedCatererId !== undefined && patch.selectedCatererId !== null) {
    const [caterer] = await db
      .select({ id: caterers.id })
      .from(caterers)
      .where(eq(caterers.id, patch.selectedCatererId))
      .limit(1);
    if (!caterer) throw new DomainError("CATERER_NOT_FOUND");
  }
  if (patch.pendingOrderId !== undefined && patch.pendingOrderId !== null) {
    const [order] = await db
      .select({ customerId: orders.customerId })
      .from(orders)
      .where(eq(orders.id, patch.pendingOrderId))
      .limit(1);
    if (!order) throw new DomainError("ORDER_NOT_FOUND");
    if (order.customerId !== customerId) throw new DomainError("UNAUTHORIZED_CUSTOMER");
  }

  const reset = patch.reset === true;
  const update: Partial<typeof cateringRequestStates.$inferInsert> = {
    updatedAt: new Date()
  };
  update.eventDate = reset
    ? null
    : patch.eventDate === undefined
      ? current.eventDate
      : patch.eventDate;
  update.budget = reset
    ? null
    : patch.budget === undefined || patch.budget === null
      ? patch.budget === null
        ? null
        : current.budget
      : centsToMoney(moneyToCents(patch.budget));
  update.dishes = reset ? [] : patch.dishes ? mergeTerms(current.dishes, patch.dishes) : current.dishes;
  update.cuisines = reset
    ? []
    : patch.cuisines
      ? mergeTerms(current.cuisines, patch.cuisines)
      : current.cuisines;
  update.headcount = reset
    ? null
    : patch.headcount === undefined
      ? current.headcount
      : patch.headcount;
  update.eventStyle = reset
    ? null
    : patch.eventStyle === undefined
      ? current.eventStyle
      : patch.eventStyle;
  update.dietaryRestrictions = reset
    ? []
    : patch.dietaryRestrictions
      ? mergeTerms(current.dietaryRestrictions, patch.dietaryRestrictions)
      : current.dietaryRestrictions;
  update.dietaryRestrictionsConfirmed = reset
    ? false
    : patch.dietaryRestrictionsConfirmed ??
      (patch.dietaryRestrictions !== undefined
        ? true
        : current.dietaryRestrictionsConfirmed);
  update.location = reset
    ? null
    : patch.location === undefined
      ? current.location
      : patch.location;
  update.fulfillmentMethod = reset
    ? null
    : patch.fulfillmentMethod === undefined
      ? current.fulfillmentMethod
      : patch.fulfillmentMethod;
  update.recentSearchResultIds = reset
    ? []
    : patch.recentSearchResultIds ?? current.recentSearchResultIds;
  update.selectedCatererId = reset
    ? null
    : patch.selectedCatererId === undefined
      ? current.selectedCatererId
      : patch.selectedCatererId;
  update.pendingOrderId = reset
    ? null
    : patch.pendingOrderId === undefined
      ? current.pendingOrderId
      : patch.pendingOrderId;

  const [state] = await db
    .update(cateringRequestStates)
    .set(update)
    .where(
      and(
        eq(cateringRequestStates.conversationId, conversationId),
        eq(cateringRequestStates.customerId, customerId)
      )
    )
    .returning();
  if (!state) throw new DomainError("REQUEST_STATE_NOT_FOUND");
  return state;
}

export async function appendAgentMessage(input: AppendAgentMessageInput) {
  const parsed = appendAgentMessageSchema.parse(input);
  const [message] = await db
    .insert(messages)
    .values(parsed)
    .onConflictDoNothing({ target: messages.externalMessageId })
    .returning();
  if (message) return message;

  const [existingMessage] = await db
    .select()
    .from(messages)
    .where(eq(messages.externalMessageId, parsed.externalMessageId))
    .limit(1);
  if (!existingMessage) {
    throw new Error("Message persistence did not return a record.");
  }
  return existingMessage;
}
