import { z } from "zod";
import { centsToMoney, moneyToCents } from "../services/money.js";
import {
  dietaryTags,
  eventStyles,
  fulfillmentMethods,
  messageSenders,
  orderStatuses,
  userRoles
} from "../types/domain.js";

const uuid = z.string().uuid();
// Accept legacy numeric inputs, then keep validated money as exact decimal strings.
const nonnegativeMoney = z
  .union([z.string().trim(), z.number().finite()])
  .transform((value) => String(value))
  .pipe(
    z.string().regex(
      /^[0-9]+(?:\.[0-9]{1,2})?$/,
      "Expected non-negative money with at most two decimal places."
    )
  )
  .refine(
    (value) => {
      const [whole = ""] = value.split(".");
      return whole.replace(/^0+/, "").length <= 10;
    },
    "Money exceeds the database numeric(12,2) limit."
  )
  .transform((value) => centsToMoney(moneyToCents(value)));
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

/**
 * A search can begin before every preference is known. Date, headcount,
 * location, and food preference are the minimum deterministic constraints;
 * omitted optional fields are not treated as defaults or filters.
 */
export const partialCateringSearchSchema = z
  .object({
    eventDate: isoDate,
    dishes: requestedTerms,
    cuisines: requestedTerms,
    headcount: z.coerce.number().int().positive(),
    location: nonEmptyText.max(255),
    budget: nonnegativeMoney.optional(),
    eventStyle: z.enum(eventStyles).optional(),
    dietaryRestrictions: z.array(z.enum(dietaryTags)).optional(),
    fulfillmentMethod: z.enum(fulfillmentMethods).optional()
  })
  .refine((value) => value.dishes.length > 0 || value.cuisines.length > 0, {
    message: "Provide at least one requested cuisine or dish."
  });

export const requestStatePatchSchema = z
  .object({
    reset: z.boolean().optional(),
    eventDate: isoDate.nullable().optional(),
    budget: nonnegativeMoney.nullable().optional(),
    dishes: z.array(nonEmptyText.max(255)).optional(),
    cuisines: z.array(nonEmptyText.max(255)).optional(),
    headcount: z.coerce.number().int().positive().nullable().optional(),
    eventStyle: z.enum(eventStyles).nullable().optional(),
    dietaryRestrictions: z.array(z.enum(dietaryTags)).optional(),
    dietaryRestrictionsConfirmed: z.boolean().optional(),
    location: nonEmptyText.max(255).nullable().optional(),
    fulfillmentMethod: z.enum(fulfillmentMethods).nullable().optional(),
    recentSearchResultIds: z.array(uuid).optional(),
    selectedCatererId: uuid.nullable().optional(),
    pendingOrderId: uuid.nullable().optional()
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one state field.");

export const createAgentSessionSchema = z.object({
  externalConversationId: nonEmptyText.max(255),
  customerId: uuid
});

export const appendAgentMessageSchema = z.object({
  conversationId: uuid,
  sender: z.enum(messageSenders),
  content: nonEmptyText.max(10_000),
  externalMessageId: nonEmptyText.max(255)
});

export const requestStateAddressSchema = z.object({
  conversationId: uuid,
  customerId: uuid
});

export const updateRequestStateRequestSchema = requestStateAddressSchema.extend({
  patch: requestStatePatchSchema
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

function isCalendarDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

export const getCatererDashboardSchema = z.object({
  catererId: uuid,
  actorUserId: uuid,
  today: isoDate.refine(isCalendarDate, "Expected a real calendar date.").optional()
});

export type CreateUserInput = z.input<typeof createUserSchema>;
export type CreateCatererInput = z.input<typeof createCatererSchema>;
export type UpdateCatererSettingsInput = z.input<typeof updateCatererSettingsSchema>;
export type CreateMenuItemInput = z.input<typeof createMenuItemSchema>;
export type UpdateMenuItemInput = z.input<typeof updateMenuItemSchema>;
export type CreateAvailabilityInput = z.input<typeof createAvailabilitySchema>;
export type CateringRequestInput = z.input<typeof cateringRequestSchema>;
export type PartialCateringSearchInput = z.input<typeof partialCateringSearchSchema>;
export type CreateOrderInput = z.input<typeof createOrderSchema>;
export type GetMenuFiltersInput = z.input<typeof getMenuFiltersSchema>;
export type GetOrdersFiltersInput = z.input<typeof getOrdersFiltersSchema>;
export type GetCatererDashboardInput = z.input<typeof getCatererDashboardSchema>;
export type RequestStatePatchInput = z.input<typeof requestStatePatchSchema>;
export type CreateAgentSessionInput = z.input<typeof createAgentSessionSchema>;
export type AppendAgentMessageInput = z.input<typeof appendAgentMessageSchema>;
