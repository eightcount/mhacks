export const domainErrorCodes = [
  "CATERER_NOT_FOUND",
  "CUSTOMER_NOT_FOUND",
  "CONVERSATION_NOT_FOUND",
  "REQUEST_STATE_NOT_FOUND",
  "ORDER_NOT_FOUND",
  "CATERER_UNAVAILABLE",
  "CAPACITY_EXCEEDED",
  "UNSUPPORTED_EVENT_STYLE",
  "UNSUPPORTED_FULFILLMENT_METHOD",
  "LOCATION_NOT_SUPPORTED",
  "DIETARY_REQUIREMENT_NOT_SUPPORTED",
  "INVALID_ORDER_TRANSITION",
  "UNAUTHORIZED_CATERER",
  "UNAUTHORIZED_CUSTOMER",
  "MENU_ITEM_NOT_FOUND",
  "INVALID_MENU_ITEM",
  "BUDGET_EXCEEDED",
  "MINIMUM_ORDER_NOT_MET"
] as const;

export type DomainErrorCode = (typeof domainErrorCodes)[number];

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message?: string
  ) {
    super(message ?? code);
    this.name = "DomainError";
  }
}
