import type { OrderStatus } from "../types/domain.js";
import { DomainError } from "./errors.js";

export const validOrderTransitions: Record<OrderStatus, readonly OrderStatus[]> = {
  DRAFT: ["REQUESTED"],
  REQUESTED: ["ACCEPTED", "DECLINED", "CANCELLED"],
  ACCEPTED: ["CANCELLED", "COMPLETED"],
  DECLINED: [],
  CANCELLED: [],
  COMPLETED: []
};

export function canTransitionOrder(
  from: OrderStatus,
  to: OrderStatus
): boolean {
  return validOrderTransitions[from].includes(to);
}

export function assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransitionOrder(from, to)) {
    throw new DomainError(
      "INVALID_ORDER_TRANSITION",
      `Cannot transition an order from ${from} to ${to}.`
    );
  }
}
