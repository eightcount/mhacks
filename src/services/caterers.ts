import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { availability, caterers, menuItems } from "../db/schema/index.js";
import type {
  Caterer,
  MenuItem
} from "../types/domain.js";
import {
  cateringRequestSchema,
  createAvailabilitySchema,
  createMenuItemSchema,
  getMenuFiltersSchema,
  partialCateringSearchSchema,
  updateCatererSettingsSchema,
  updateMenuItemSchema,
  type CreateAvailabilityInput,
  type CateringRequestInput,
  type CreateMenuItemInput,
  type GetMenuFiltersInput,
  type PartialCateringSearchInput,
  type UpdateCatererSettingsInput,
  type UpdateMenuItemInput
} from "../validation/index.js";
import { DomainError } from "./errors.js";
import { assertCatererOwnership } from "./authorization.js";
import { exactLocationMatcher, type LocationMatcher } from "./location.js";
import {
  assessAvailability,
  evaluateCatererMatch,
  evaluatePartialCatererMatch,
  isFullCatererMatch,
  isPartialCatererMatch,
  type AvailabilityAssessment,
  type CatererMatch
} from "./matching.js";
import type { PartialCatererMatch } from "./matching.js";
import { centsToMoney, moneyToCents } from "./money.js";

export interface SearchCatererResult {
  caterer: Caterer;
  match: CatererMatch;
}

export interface PartialSearchCatererResult {
  caterer: Caterer;
  match: PartialCatererMatch;
}

export interface SearchCaterersOptions {
  locationMatcher?: LocationMatcher;
}

function menuMatchesRequestedDish(menuItem: MenuItem, requestedDish: string): boolean {
  return menuItem.name.toLocaleLowerCase().includes(requestedDish.trim().toLocaleLowerCase());
}

async function getCatererOrThrow(catererId: string): Promise<Caterer> {
  const [caterer] = await db.select().from(caterers).where(eq(caterers.id, catererId)).limit(1);
  if (!caterer) {
    throw new DomainError("CATERER_NOT_FOUND");
  }
  return caterer;
}

export function getCaterer(catererId: string): Promise<Caterer> {
  return getCatererOrThrow(catererId);
}

async function assertCatererOwner(catererId: string, actorUserId: string): Promise<Caterer> {
  const caterer = await getCatererOrThrow(catererId);
  assertCatererOwnership(caterer, actorUserId);
  return caterer;
}

export async function searchCaterers(
  criteria: CateringRequestInput,
  options: SearchCaterersOptions = {}
): Promise<SearchCatererResult[]> {
  const request = cateringRequestSchema.parse(criteria);
  const activeCaterers = await db
    .select()
    .from(caterers)
    .where(eq(caterers.active, true));

  if (activeCaterers.length === 0) {
    return [];
  }

  const catererIds = activeCaterers.map((caterer) => caterer.id);
  const [activeMenuItems, availabilityEntries] = await Promise.all([
    db
      .select()
      .from(menuItems)
      .where(and(inArray(menuItems.catererId, catererIds), eq(menuItems.active, true))),
    db.select().from(availability).where(eq(availability.date, request.eventDate))
  ]);

  return activeCaterers.flatMap((caterer) => {
    const match = evaluateCatererMatch(
      request,
      {
        caterer,
        menuItems: activeMenuItems.filter((item) => item.catererId === caterer.id),
        availabilityEntry: availabilityEntries.find((entry) => entry.catererId === caterer.id)
      },
      options.locationMatcher ?? exactLocationMatcher
    );

    return isFullCatererMatch(request, match) ? [{ caterer, match }] : [];
  });
}

/**
 * Finds candidates using only explicitly known request fields. This is used by
 * the conversational layer before optional preferences are collected; omitted
 * preferences are reported as null rather than silently assumed.
 */
export async function searchCaterersPartial(
  criteria: PartialCateringSearchInput,
  options: SearchCaterersOptions = {}
): Promise<PartialSearchCatererResult[]> {
  const request = partialCateringSearchSchema.parse(criteria);
  const activeCaterers = await db
    .select()
    .from(caterers)
    .where(eq(caterers.active, true));
  if (activeCaterers.length === 0) return [];

  const catererIds = activeCaterers.map((caterer) => caterer.id);
  const [activeMenuItems, availabilityEntries] = await Promise.all([
    db
      .select()
      .from(menuItems)
      .where(and(inArray(menuItems.catererId, catererIds), eq(menuItems.active, true))),
    db.select().from(availability).where(eq(availability.date, request.eventDate))
  ]);

  return activeCaterers.flatMap((caterer) => {
    const match = evaluatePartialCatererMatch(
      request,
      {
        caterer,
        menuItems: activeMenuItems.filter((item) => item.catererId === caterer.id),
        availabilityEntry: availabilityEntries.find((entry) => entry.catererId === caterer.id)
      },
      options.locationMatcher ?? exactLocationMatcher
    );
    return isPartialCatererMatch(request, match) ? [{ caterer, match }] : [];
  });
}

export async function checkAvailability(
  catererId: string,
  eventDate: string,
  headcount: number
): Promise<AvailabilityAssessment> {
  const caterer = await getCatererOrThrow(catererId);
  const [availabilityEntry] = await db
    .select()
    .from(availability)
    .where(and(eq(availability.catererId, catererId), eq(availability.date, eventDate)))
    .limit(1);

  return assessAvailability(caterer, availabilityEntry, headcount);
}

export async function getMenu(
  catererId: string,
  filters: GetMenuFiltersInput = {}
): Promise<MenuItem[]> {
  await getCatererOrThrow(catererId);
  const parsedFilters = getMenuFiltersSchema.parse(filters);
  const rows = await db
    .select()
    .from(menuItems)
    .where(
      parsedFilters.includeInactive
        ? eq(menuItems.catererId, catererId)
        : and(eq(menuItems.catererId, catererId), eq(menuItems.active, true))
    );

  return rows.filter((item) => {
    const satisfiesDietaryRestrictions =
      !parsedFilters.dietaryRestrictions ||
      parsedFilters.dietaryRestrictions.every((restriction) =>
        item.dietaryTags.includes(restriction)
      );
    const satisfiesDishTerms =
      !parsedFilters.requestedDishes ||
      parsedFilters.requestedDishes.some((dish) => menuMatchesRequestedDish(item, dish));

    return satisfiesDietaryRestrictions && satisfiesDishTerms;
  });
}

export async function updateAvailability(
  actorUserId: string,
  input: CreateAvailabilityInput
) {
  const parsed = createAvailabilitySchema.parse(input);
  await assertCatererOwner(parsed.catererId, actorUserId);

  const [entry] = await db
    .insert(availability)
    .values({
      catererId: parsed.catererId,
      date: parsed.date,
      available: parsed.available,
      capacityOverride: parsed.capacityOverride ?? null
    })
    .onConflictDoUpdate({
      target: [availability.catererId, availability.date],
      set: {
        available: parsed.available,
        capacityOverride: parsed.capacityOverride ?? null,
        updatedAt: new Date()
      }
    })
    .returning();

  if (!entry) {
    throw new Error("Availability update did not return a record.");
  }
  return entry;
}

export async function addMenuItem(actorUserId: string, input: CreateMenuItemInput) {
  const parsed = createMenuItemSchema.parse(input);
  await assertCatererOwner(parsed.catererId, actorUserId);

  const [menuItem] = await db
    .insert(menuItems)
    .values({
      catererId: parsed.catererId,
      name: parsed.name,
      description: parsed.description,
      price: centsToMoney(moneyToCents(parsed.price)),
      dietaryTags: parsed.dietaryTags,
      active: parsed.active
    })
    .returning();

  if (!menuItem) {
    throw new Error("Menu item creation did not return a record.");
  }
  return menuItem;
}

export async function updateMenuItem(
  actorUserId: string,
  menuItemId: string,
  input: UpdateMenuItemInput
) {
  const parsed = updateMenuItemSchema.parse(input);
  const [existingItem] = await db
    .select()
    .from(menuItems)
    .where(eq(menuItems.id, menuItemId))
    .limit(1);
  if (!existingItem) {
    throw new DomainError("MENU_ITEM_NOT_FOUND");
  }

  await assertCatererOwner(existingItem.catererId, actorUserId);
  const update: Partial<typeof menuItems.$inferInsert> = { updatedAt: new Date() };
  if (parsed.name !== undefined) update.name = parsed.name;
  if (parsed.description !== undefined) update.description = parsed.description;
  if (parsed.price !== undefined) update.price = centsToMoney(moneyToCents(parsed.price));
  if (parsed.dietaryTags !== undefined) update.dietaryTags = parsed.dietaryTags;
  if (parsed.active !== undefined) update.active = parsed.active;

  const [menuItem] = await db
    .update(menuItems)
    .set(update)
    .where(eq(menuItems.id, menuItemId))
    .returning();
  if (!menuItem) {
    throw new DomainError("MENU_ITEM_NOT_FOUND");
  }
  return menuItem;
}

export function deactivateMenuItem(
  actorUserId: string,
  menuItemId: string
) {
  return updateMenuItem(actorUserId, menuItemId, { active: false });
}

export async function updateCatererSettings(
  actorUserId: string,
  catererId: string,
  input: UpdateCatererSettingsInput
) {
  const parsed = updateCatererSettingsSchema.parse(input);
  await assertCatererOwner(catererId, actorUserId);
  const update: Partial<typeof caterers.$inferInsert> = { updatedAt: new Date() };
  if (parsed.location !== undefined) update.location = parsed.location;
  if (parsed.serviceAreas !== undefined) update.serviceAreas = parsed.serviceAreas;
  if (parsed.serviceRadius !== undefined) update.serviceRadius = parsed.serviceRadius;
  if (parsed.maximumCapacity !== undefined) update.maximumCapacity = parsed.maximumCapacity;
  if (parsed.minimumOrder !== undefined) {
    update.minimumOrder = centsToMoney(moneyToCents(parsed.minimumOrder));
  }
  if (parsed.supportedEventStyles !== undefined) {
    update.supportedEventStyles = parsed.supportedEventStyles;
  }
  if (parsed.fulfillmentMethod !== undefined) {
    update.fulfillmentMethod = parsed.fulfillmentMethod;
  }
  if (parsed.deliveryRadius !== undefined) update.deliveryRadius = parsed.deliveryRadius;
  if (parsed.deliveryFee !== undefined) {
    update.deliveryFee =
      parsed.deliveryFee === null ? null : centsToMoney(moneyToCents(parsed.deliveryFee));
  }
  if (parsed.minimumDeliveryOrder !== undefined) {
    update.minimumDeliveryOrder =
      parsed.minimumDeliveryOrder === null
        ? null
        : centsToMoney(moneyToCents(parsed.minimumDeliveryOrder));
  }

  const [caterer] = await db
    .update(caterers)
    .set(update)
    .where(eq(caterers.id, catererId))
    .returning();
  if (!caterer) {
    throw new DomainError("CATERER_NOT_FOUND");
  }
  return caterer;
}
