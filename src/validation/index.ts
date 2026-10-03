import { z } from "zod";
import {
  dietaryTags,
  eventStyles,
  fulfillmentMethods,
  orderStatuses,
  userRoles
} from "../types/domain.js";

const uuid = z.string().uuid();
const nonnegativeMoney = z
  .coerce
  .number()
  .finite()
  .nonnegative()
  .refine((value) => Number.isInteger(value * 100), "Expected at most two decimal places.");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date.");
const nonEmptyText = z.string().trim().min(1);
const dietaryRestrictions = z.array(z.enum(dietaryTags)).default([]);
const requestedTerms = z.array(nonEmptyText.max(255)).default([]);

export const createUserSchema = z.object({
  messagingIdentifier: nonEmptyText.max(255),
  name: nonEmptyText.max(255),
  role: z.enum(userRoles)
});

const catererServiceSettings = z.object({
  serviceAreas: z.array(nonEmptyText.max(255)).default([]),
  supportedEventStyles: z.array(z.enum(eventStyles)).min(1),
  fulfillmentMethod: z.enum(fulfillmentMethods),
  deliveryRadius: z.coerce.number().int().nonnegative().nullable().optional(),
  deliveryFee: nonnegativeMoney.nullable().optional(),
  minimumDeliveryOrder: nonnegativeMoney.nullable().optional()
});

export const createCatererSchema = z
  .object({
    ownerUserId: uuid,
    businessName: nonEmptyText.max(255),
    description: nonEmptyText,
    cuisineTypes: z.array(nonEmptyText.max(100)).min(1),
    location: nonEmptyText.max(255),
    serviceRadius: z.coerce.number().int().nonnegative(),
    minimumOrder: nonnegativeMoney,
    maximumCapacity: z.coerce.number().int().positive(),
    active: z.boolean().optional().default(true)
  })
  .merge(catererServiceSettings);

export const updateCatererSettingsSchema = z
  .object({
    location: nonEmptyText.max(255).optional(),
    serviceAreas: z.array(nonEmptyText.max(255)).optional(),
    serviceRadius: z.coerce.number().int().nonnegative().optional(),
    maximumCapacity: z.coerce.number().int().positive().optional(),
    minimumOrder: nonnegativeMoney.optional(),
    supportedEventStyles: z.array(z.enum(eventStyles)).min(1).optional(),
    fulfillmentMethod: z.enum(fulfillmentMethods).optional(),
    deliveryRadius: z.coerce.number().int().nonnegative().nullable().optional(),
    deliveryFee: nonnegativeMoney.nullable().optional(),
    minimumDeliveryOrder: nonnegativeMoney.nullable().optional()
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one setting.");

export const createMenuItemSchema = z.object({
  catererId: uuid,
  name: nonEmptyText.max(255),
  description: nonEmptyText,
  price: nonnegativeMoney,
  dietaryTags: z.array(z.enum(dietaryTags)).default([]),
  active: z.boolean().optional().default(true)
});

export const updateMenuItemSchema = z
  .object({
    name: nonEmptyText.max(255).optional(),
    description: nonEmptyText.optional(),
    price: nonnegativeMoney.optional(),
    dietaryTags: z.array(z.enum(dietaryTags)).optional(),
    active: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one menu item field.");

export const createAvailabilitySchema = z.object({
  catererId: uuid,
  date: isoDate,
  available: z.boolean().optional().default(true),
  capacityOverride: z.coerce.number().int().positive().nullable().optional()
});

export const cateringRequestSchema = z.object({
  eventDate: isoDate,
  budget: nonnegativeMoney,
  dishes: requestedTerms,
  cuisines: requestedTerms,
  headcount: z.coerce.number().int().positive(),
  eventStyle: z.enum(eventStyles),
  dietaryRestrictions,
  location: nonEmptyText.max(255),
  fulfillmentMethod: z.enum(fulfillmentMethods)
});

export const createOrderSchema = cateringRequestSchema.extend({
  customerId: uuid,
  catererId: uuid,
  menuItems: z
    .array(
      z.object({
        menuItemId: uuid,
        quantity: z.coerce.number().int().positive()
      })
    )
    .min(1)
    .superRefine((items, context) => {
      const ids = new Set<string>();
      for (const [index, item] of items.entries()) {
        if (ids.has(item.menuItemId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, "menuItemId"],
            message: "A menu item may be selected only once."
          });
        }
        ids.add(item.menuItemId);
      }
    }),
  specialRequests: z.string().trim().max(5_000).nullable().optional()
});

export const getMenuFiltersSchema = z.object({
  dietaryRestrictions: z.array(z.enum(dietaryTags)).optional(),
  requestedDishes: z.array(nonEmptyText.max(255)).optional(),
  includeInactive: z.boolean().optional().default(false)
});

export const getOrdersFiltersSchema = z
  .object({
    customerId: uuid.optional(),
    catererId: uuid.optional(),
    status: z.enum(orderStatuses).optional(),
    eventDate: isoDate.optional(),
    eventDateFrom: isoDate.optional(),
    eventDateTo: isoDate.optional()
  })
  .refine(
    (value) => !value.eventDateFrom || !value.eventDateTo || value.eventDateFrom <= value.eventDateTo,
    "eventDateFrom must be before or equal to eventDateTo."
  );

export type CreateUserInput = z.input<typeof createUserSchema>;
export type CreateCatererInput = z.input<typeof createCatererSchema>;
export type UpdateCatererSettingsInput = z.input<typeof updateCatererSettingsSchema>;
export type CreateMenuItemInput = z.input<typeof createMenuItemSchema>;
export type UpdateMenuItemInput = z.input<typeof updateMenuItemSchema>;
export type CreateAvailabilityInput = z.input<typeof createAvailabilitySchema>;
export type CateringRequestInput = z.input<typeof cateringRequestSchema>;
export type CreateOrderInput = z.input<typeof createOrderSchema>;
export type GetMenuFiltersInput = z.input<typeof getMenuFiltersSchema>;
export type GetOrdersFiltersInput = z.input<typeof getOrdersFiltersSchema>;
