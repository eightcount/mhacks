import { z } from "zod";
import {
  checkAvailability,
  createOrder,
  getCaterer,
  getMenu,
  getCustomerOrder,
  getCustomerOrders,
  requestOrder,
  searchCaterers,
  searchCaterersPartial
} from "../services/index.js";
import {
  cateringRequestSchema,
  createOrderSchema,
  getMenuFiltersSchema,
  partialCateringSearchSchema
} from "../validation/index.js";

const identifierSchema = z.string().uuid();
const availabilityToolSchema = z.object({
  catererId: identifierSchema,
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  headcount: z.coerce.number().int().positive()
});
const getMenuToolSchema = z.object({
  catererId: identifierSchema,
  filters: getMenuFiltersSchema.optional()
});
const getCatererToolSchema = z.object({ catererId: identifierSchema });
const requestOrderToolSchema = z.object({
  orderId: identifierSchema,
  customerId: identifierSchema
});
const getOrderToolSchema = z.object({ orderId: identifierSchema, customerId: identifierSchema }).strict();

function publicCaterer(caterer: Awaited<ReturnType<typeof getCaterer>>) {
  return {
    id: caterer.id,
    businessName: caterer.businessName,
    description: caterer.description,
    cuisineTypes: caterer.cuisineTypes,
    location: caterer.location,
    serviceAreas: caterer.serviceAreas,
    minimumOrder: caterer.minimumOrder,
    maximumCapacity: caterer.maximumCapacity,
    supportedEventStyles: caterer.supportedEventStyles,
    fulfillmentMethod: caterer.fulfillmentMethod,
    deliveryFee: caterer.deliveryFee,
    active: caterer.active
  };
}

export async function searchCaterersTool(input: unknown) {
  const fullCriteria = cateringRequestSchema.safeParse(input);
  const matches = fullCriteria.success
    ? await searchCaterers(fullCriteria.data)
    : await searchCaterersPartial(partialCateringSearchSchema.parse(input));
  return {
    matches: matches.map(({ caterer, match }) => ({
      caterer: publicCaterer(caterer),
      match
    }))
  };
}

export async function getCatererTool(input: unknown) {
  const parsed = getCatererToolSchema.parse(input);
  return { caterer: publicCaterer(await getCaterer(parsed.catererId)) };
}

export async function getMenuTool(input: unknown) {
  const parsed = getMenuToolSchema.parse(input);
  return { menuItems: await getMenu(parsed.catererId, parsed.filters) };
}

export async function checkAvailabilityTool(input: unknown) {
  const parsed = availabilityToolSchema.parse(input);
  return {
    availability: await checkAvailability(parsed.catererId, parsed.eventDate, parsed.headcount)
  };
}

export async function createOrderTool(input: unknown) {
  const parsed = createOrderSchema.parse(input);
  return { order: await createOrder(parsed) };
}

export async function requestOrderTool(input: unknown) {
  const parsed = requestOrderToolSchema.parse(input);
  return { order: await requestOrder(parsed.orderId, parsed.customerId) };
}

export async function getOrderTool(input: unknown) {
  const parsed = getOrderToolSchema.parse(input);
  return { order: await getCustomerOrder(parsed.orderId, parsed.customerId) };
}

export async function getOrdersTool(input: unknown) {
  return getCustomerOrders(input);
}
