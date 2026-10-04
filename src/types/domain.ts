import type {
  availability,
  cateringRequestStates,
  caterers,
  menuItems,
  orderItems,
  orders,
  users
} from "../db/schema/index.js";

export const userRoles = ["CUSTOMER", "CATERER"] as const;
export type UserRole = (typeof userRoles)[number];

export const orderStatuses = [
  "DRAFT",
  "REQUESTED",
  "ACCEPTED",
  "DECLINED",
  "CANCELLED",
  "COMPLETED"
] as const;
export type OrderStatus = (typeof orderStatuses)[number];

export const dietaryTags = ["VEGETARIAN", "VEGAN", "GLUTEN_FREE", "HALAL"] as const;
export type DietaryTag = (typeof dietaryTags)[number];

export const eventStyles = [
  "BUFFET",
  "FAMILY_STYLE",
  "INDIVIDUAL_MEALS",
  "DROP_OFF",
  "FORMAL",
  "CASUAL"
] as const;
export type EventStyle = (typeof eventStyles)[number];

export const fulfillmentMethods = ["PICKUP", "DELIVERY", "EITHER"] as const;
export type FulfillmentMethod = (typeof fulfillmentMethods)[number];

export const messageSenders = ["CUSTOMER", "CATERER", "SYSTEM"] as const;
export type MessageSender = (typeof messageSenders)[number];

/**
 * A deterministic, structured customer request. Dates are YYYY-MM-DD strings
 * to align with PostgreSQL's date column and avoid timezone shifts.
 */
export interface CateringRequest {
  eventDate: string;
  budget: string;
  dishes: string[];
  cuisines: string[];
  headcount: number;
  eventStyle: EventStyle;
  dietaryRestrictions: DietaryTag[];
  location: string;
  fulfillmentMethod: FulfillmentMethod;
}

export type User = typeof users.$inferSelect;
export type Caterer = typeof caterers.$inferSelect;
export type MenuItem = typeof menuItems.$inferSelect;
export type Availability = typeof availability.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type CateringRequestState = typeof cateringRequestStates.$inferSelect;
