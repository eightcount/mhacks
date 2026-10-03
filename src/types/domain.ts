import type {
  availability,
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

export const messageSenders = ["CUSTOMER", "CATERER", "SYSTEM"] as const;
export type MessageSender = (typeof messageSenders)[number];

export type User = typeof users.$inferSelect;
export type Caterer = typeof caterers.$inferSelect;
export type MenuItem = typeof menuItems.$inferSelect;
export type Availability = typeof availability.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
