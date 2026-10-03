import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "../db/index.js";
import { availability, caterers, menuItems, orderItems, orders, users } from "../db/schema/index.js";
import type { Order, OrderItem } from "../types/domain.js";
import {
  createOrderSchema,
  getOrdersFiltersSchema,
  type CreateOrderInput,
  type GetOrdersFiltersInput
} from "../validation/index.js";
import { DomainError } from "./errors.js";
import { exactLocationMatcher } from "./location.js";
import { assessAvailability } from "./matching.js";
import { calculateOrderTotal, centsToMoney, moneyToCents } from "./money.js";
import { assertOrderTransition } from "./order-state.js";

export interface OrderWithItems {
  order: Order;
  items: OrderItem[];
}

async function getOrderRowOrThrow(orderId: string): Promise<Order> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) {
    throw new DomainError("ORDER_NOT_FOUND");
  }
  return order;
}

function supportsFulfillment(
  catererFulfillmentMethod: Order["fulfillmentMethod"],
  requestedFulfillmentMethod: Order["fulfillmentMethod"]
): boolean {
  return (
    requestedFulfillmentMethod === "EITHER" ||
    catererFulfillmentMethod === "EITHER" ||
    catererFulfillmentMethod === requestedFulfillmentMethod
  );
}

export async function createOrder(input: CreateOrderInput): Promise<OrderWithItems> {
  const parsed = createOrderSchema.parse(input);
  const [[customer], [caterer], [availabilityEntry]] = await Promise.all([
    db.select().from(users).where(eq(users.id, parsed.customerId)).limit(1),
    db.select().from(caterers).where(eq(caterers.id, parsed.catererId)).limit(1),
    db
      .select()
      .from(availability)
      .where(
        and(
          eq(availability.catererId, parsed.catererId),
          eq(availability.date, parsed.eventDate)
        )
      )
      .limit(1)
  ]);

  if (!customer || customer.role !== "CUSTOMER") {
    throw new DomainError("CUSTOMER_NOT_FOUND");
  }
  if (!caterer) {
    throw new DomainError("CATERER_NOT_FOUND");
  }
  if (!caterer.active) {
    throw new DomainError("CATERER_UNAVAILABLE");
  }

  const availabilityAssessment = assessAvailability(
    caterer,
    availabilityEntry,
    parsed.headcount
  );
  if (!availabilityAssessment.available) {
    throw new DomainError(
      availabilityAssessment.reason === "CAPACITY_EXCEEDED"
        ? "CAPACITY_EXCEEDED"
        : "CATERER_UNAVAILABLE"
    );
  }
  if (!caterer.supportedEventStyles.includes(parsed.eventStyle)) {
    throw new DomainError("UNSUPPORTED_EVENT_STYLE");
  }
  if (
    !exactLocationMatcher.canServe({
      catererLocation: caterer.location,
      serviceAreas: caterer.serviceAreas,
      requestedLocation: parsed.location
    })
  ) {
    throw new DomainError("LOCATION_NOT_SUPPORTED");
  }
  if (!supportsFulfillment(caterer.fulfillmentMethod, parsed.fulfillmentMethod)) {
    throw new DomainError("UNSUPPORTED_FULFILLMENT_METHOD");
  }

  const selectedMenuItemIds = parsed.menuItems.map((item) => item.menuItemId);
  const [selectedMenuRows, catererActiveMenu] = await Promise.all([
    db
      .select()
      .from(menuItems)
      .where(inArray(menuItems.id, selectedMenuItemIds)),
    db
      .select()
      .from(menuItems)
      .where(and(eq(menuItems.catererId, caterer.id), eq(menuItems.active, true)))
  ]);
  const selectedMenuById = new Map(selectedMenuRows.map((item) => [item.id, item]));

  const selectedItems = parsed.menuItems.map((selection) => {
    const menuItem = selectedMenuById.get(selection.menuItemId);
    if (!menuItem) {
      throw new DomainError("MENU_ITEM_NOT_FOUND");
    }
    if (menuItem.catererId !== caterer.id || !menuItem.active) {
      throw new DomainError("INVALID_MENU_ITEM");
    }
    return { menuItem, quantity: selection.quantity };
  });

  const allDietaryRequirementsSupported = parsed.dietaryRestrictions.every((restriction) =>
    catererActiveMenu.some((menuItem) => menuItem.dietaryTags.includes(restriction))
  );
  if (!allDietaryRequirementsSupported) {
    throw new DomainError("DIETARY_REQUIREMENT_NOT_SUPPORTED");
  }

  const subtotal = calculateOrderTotal(
    selectedItems.map(({ menuItem, quantity }) => ({ quantity, unitPrice: menuItem.price }))
  );
  const deliveryFeeCents =
    parsed.fulfillmentMethod === "DELIVERY" && caterer.deliveryFee
      ? moneyToCents(caterer.deliveryFee)
      : 0;
  const totalCents = subtotal.cents + deliveryFeeCents;
  const minimumRequiredCents = Math.max(
    moneyToCents(caterer.minimumOrder),
    parsed.fulfillmentMethod === "DELIVERY" && caterer.minimumDeliveryOrder
      ? moneyToCents(caterer.minimumDeliveryOrder)
      : 0
  );
  if (subtotal.cents < minimumRequiredCents) {
    throw new DomainError("MINIMUM_ORDER_NOT_MET");
  }
  if (totalCents > moneyToCents(parsed.budget)) {
    throw new DomainError("BUDGET_EXCEEDED");
  }

  return db.transaction(async (tx) => {
    const [order] = await tx
      .insert(orders)
      .values({
        customerId: parsed.customerId,
        catererId: parsed.catererId,
        eventDate: parsed.eventDate,
        guestCount: parsed.headcount,
        budget: centsToMoney(moneyToCents(parsed.budget)),
        estimatedTotal: centsToMoney(totalCents),
        requestedDishes: parsed.dishes,
        requestedCuisines: parsed.cuisines,
        eventStyle: parsed.eventStyle,
        dietaryRestrictions: parsed.dietaryRestrictions,
        eventLocation: parsed.location,
        fulfillmentMethod: parsed.fulfillmentMethod,
        specialRequests: parsed.specialRequests ?? null,
        status: "DRAFT"
      })
      .returning();
    if (!order) {
      throw new Error("Order creation did not return a record.");
    }

    const createdItems = await tx
      .insert(orderItems)
      .values(
        selectedItems.map(({ menuItem, quantity }) => ({
          orderId: order.id,
          menuItemId: menuItem.id,
          quantity,
          unitPrice: menuItem.price
        }))
      )
      .returning();

    return { order, items: createdItems };
  });
}

async function transitionOrder(orderId: string, nextStatus: Order["status"]): Promise<Order> {
  const order = await getOrderRowOrThrow(orderId);
  assertOrderTransition(order.status, nextStatus);
  const [updatedOrder] = await db
    .update(orders)
    .set({ status: nextStatus, updatedAt: new Date() })
    .where(eq(orders.id, orderId))
    .returning();
  if (!updatedOrder) {
    throw new DomainError("ORDER_NOT_FOUND");
  }
  return updatedOrder;
}

export async function requestOrder(orderId: string, customerId: string): Promise<Order> {
  const order = await getOrderRowOrThrow(orderId);
  if (order.customerId !== customerId) {
    throw new DomainError("UNAUTHORIZED_CUSTOMER");
  }
  return transitionOrder(orderId, "REQUESTED");
}

export async function acceptOrder(orderId: string, catererId: string): Promise<Order> {
  const order = await getOrderRowOrThrow(orderId);
  if (order.catererId !== catererId) {
    throw new DomainError("UNAUTHORIZED_CATERER");
  }
  return transitionOrder(orderId, "ACCEPTED");
}

export async function declineOrder(orderId: string, catererId: string): Promise<Order> {
  const order = await getOrderRowOrThrow(orderId);
  if (order.catererId !== catererId) {
    throw new DomainError("UNAUTHORIZED_CATERER");
  }
  return transitionOrder(orderId, "DECLINED");
}

export async function cancelOrder(orderId: string, customerId: string): Promise<Order> {
  const order = await getOrderRowOrThrow(orderId);
  if (order.customerId !== customerId) {
    throw new DomainError("UNAUTHORIZED_CUSTOMER");
  }
  return transitionOrder(orderId, "CANCELLED");
}

export async function completeOrder(orderId: string, catererId: string): Promise<Order> {
  const order = await getOrderRowOrThrow(orderId);
  if (order.catererId !== catererId) {
    throw new DomainError("UNAUTHORIZED_CATERER");
  }
  return transitionOrder(orderId, "COMPLETED");
}

export async function getOrder(orderId: string): Promise<OrderWithItems> {
  const order = await getOrderRowOrThrow(orderId);
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  return { order, items };
}

export async function getOrders(filters: GetOrdersFiltersInput = {}): Promise<Order[]> {
  const parsed = getOrdersFiltersSchema.parse(filters);
  return db
    .select()
    .from(orders)
    .where(
      and(
        parsed.customerId ? eq(orders.customerId, parsed.customerId) : undefined,
        parsed.catererId ? eq(orders.catererId, parsed.catererId) : undefined,
        parsed.status ? eq(orders.status, parsed.status) : undefined,
        parsed.eventDate ? eq(orders.eventDate, parsed.eventDate) : undefined,
        parsed.eventDateFrom ? gte(orders.eventDate, parsed.eventDateFrom) : undefined,
        parsed.eventDateTo ? lte(orders.eventDate, parsed.eventDateTo) : undefined
      )
    );
}
