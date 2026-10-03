import { z } from "zod";
import {
  dietaryTags,
  orderStatuses,
  userRoles
} from "../types/domain.js";

const uuid = z.string().uuid();
const nonnegativeMoney = z.coerce.number().finite().nonnegative();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date.");
const nonEmptyText = z.string().trim().min(1);

export const createUserSchema = z.object({
  messagingIdentifier: nonEmptyText.max(255),
  name: nonEmptyText.max(255),
  role: z.enum(userRoles)
});

export const createCatererSchema = z.object({
  ownerUserId: uuid,
  businessName: nonEmptyText.max(255),
  description: nonEmptyText,
  cuisineTypes: z.array(nonEmptyText.max(100)).min(1),
  location: nonEmptyText.max(255),
  serviceRadius: z.coerce.number().int().nonnegative(),
  minimumOrder: nonnegativeMoney,
  maximumCapacity: z.coerce.number().int().positive(),
  active: z.boolean().optional().default(true)
});

export const createMenuItemSchema = z.object({
  catererId: uuid,
  name: nonEmptyText.max(255),
  description: nonEmptyText,
  price: nonnegativeMoney,
  dietaryTags: z.array(z.enum(dietaryTags)).default([]),
  active: z.boolean().optional().default(true)
});

export const createAvailabilitySchema = z.object({
  catererId: uuid,
  date: isoDate,
  available: z.boolean().optional().default(true),
  capacityOverride: z.coerce.number().int().positive().nullable().optional()
});

export const createOrderSchema = z.object({
  customerId: uuid,
  catererId: uuid,
  eventDate: isoDate,
  guestCount: z.coerce.number().int().positive(),
  budget: nonnegativeMoney,
  estimatedTotal: nonnegativeMoney,
  status: z.enum(orderStatuses).optional().default("DRAFT"),
  specialRequests: z.string().trim().max(5_000).nullable().optional()
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type CreateCatererInput = z.infer<typeof createCatererSchema>;
export type CreateMenuItemInput = z.infer<typeof createMenuItemSchema>;
export type CreateAvailabilityInput = z.infer<typeof createAvailabilitySchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
