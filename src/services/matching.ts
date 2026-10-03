import type {
  Availability,
  Caterer,
  CateringRequest,
  DietaryTag,
  FulfillmentMethod,
  MenuItem
} from "../types/domain.js";
import { exactLocationMatcher, type LocationMatcher } from "./location.js";
import { centsToMoney, moneyToCents } from "./money.js";

export const availabilityReasons = [
  "AVAILABLE",
  "INACTIVE_CATERER",
  "NO_AVAILABILITY_RECORD",
  "DATE_UNAVAILABLE",
  "CAPACITY_EXCEEDED"
] as const;
export type AvailabilityReason = (typeof availabilityReasons)[number];

export interface AvailabilityAssessment {
  available: boolean;
  reason: AvailabilityReason;
  supportedCapacity: number | null;
}

export interface CatererMatch {
  available: boolean;
  availabilityReason: AvailabilityReason;
  budgetPlausible: boolean;
  minimumEstimatedTotal: string | null;
  cuisineMatch: boolean;
  matchedCuisines: string[];
  requestedDishesAvailable: string[];
  requestedDishesUnavailable: string[];
  capacitySupported: boolean;
  eventStyleSupported: boolean;
  dietaryRequirementsSupported: DietaryTag[];
  dietaryRequirementsUnsupported: DietaryTag[];
  locationSupported: boolean;
  fulfillmentSupported: boolean;
}

export interface CatererSearchCandidate {
  caterer: Caterer;
  menuItems: MenuItem[];
  availabilityEntry: Availability | undefined;
}

const normalizeTerm = (term: string): string => term.trim().toLocaleLowerCase();

function menuMatchesDish(menuItem: MenuItem, requestedDish: string): boolean {
  return menuItem.name.toLocaleLowerCase().includes(normalizeTerm(requestedDish));
}

function supportsFulfillment(
  supported: FulfillmentMethod,
  requested: FulfillmentMethod
): boolean {
  return requested === "EITHER" || supported === "EITHER" || supported === requested;
}

export function assessAvailability(
  caterer: Caterer,
  availabilityEntry: Availability | undefined,
  headcount: number
): AvailabilityAssessment {
  if (!caterer.active) {
    return { available: false, reason: "INACTIVE_CATERER", supportedCapacity: null };
  }

  if (!availabilityEntry) {
    return { available: false, reason: "NO_AVAILABILITY_RECORD", supportedCapacity: null };
  }

  if (!availabilityEntry.available) {
    return { available: false, reason: "DATE_UNAVAILABLE", supportedCapacity: null };
  }

  const supportedCapacity = availabilityEntry.capacityOverride ?? caterer.maximumCapacity;
  if (headcount > supportedCapacity) {
    return { available: false, reason: "CAPACITY_EXCEEDED", supportedCapacity };
  }

  return { available: true, reason: "AVAILABLE", supportedCapacity };
}

export function evaluateCatererMatch(
  criteria: CateringRequest,
  candidate: CatererSearchCandidate,
  locationMatcher: LocationMatcher = exactLocationMatcher
): CatererMatch {
  const { caterer } = candidate;
  const activeMenuItems = candidate.menuItems.filter((item) => item.active);
  const availability = assessAvailability(caterer, candidate.availabilityEntry, criteria.headcount);
  const matchedCuisines = criteria.cuisines.filter((requestedCuisine) =>
    caterer.cuisineTypes.some(
      (cuisine) => normalizeTerm(cuisine) === normalizeTerm(requestedCuisine)
    )
  );
  const cuisineMatch = criteria.cuisines.length === 0 || matchedCuisines.length > 0;
  const requestedDishesAvailable = criteria.dishes.filter((requestedDish) =>
    activeMenuItems.some((item) => menuMatchesDish(item, requestedDish))
  );
  const requestedDishesUnavailable = criteria.dishes.filter(
    (requestedDish) => !requestedDishesAvailable.includes(requestedDish)
  );
  const relevantMenuItems =
    criteria.dishes.length > 0
      ? activeMenuItems.filter((item) =>
          criteria.dishes.some((requestedDish) => menuMatchesDish(item, requestedDish))
        )
      : activeMenuItems;
  const lowestRelevantPriceCents = relevantMenuItems.reduce<number | null>((lowest, item) => {
    const price = moneyToCents(item.price);
    return lowest === null || price < lowest ? price : lowest;
  }, null);
  const deliveryMinimumCents =
    criteria.fulfillmentMethod === "DELIVERY" && caterer.minimumDeliveryOrder
      ? moneyToCents(caterer.minimumDeliveryOrder)
      : 0;
  const deliveryFeeCents =
    criteria.fulfillmentMethod === "DELIVERY" && caterer.deliveryFee
      ? moneyToCents(caterer.deliveryFee)
      : 0;
  const minimumEstimatedCents =
    lowestRelevantPriceCents === null
      ? null
      : Math.max(
          moneyToCents(caterer.minimumOrder),
          lowestRelevantPriceCents * criteria.headcount,
          deliveryMinimumCents
        ) + deliveryFeeCents;
  const budgetPlausible =
    minimumEstimatedCents !== null && minimumEstimatedCents <= moneyToCents(criteria.budget);
  const dietaryRequirementsSupported = criteria.dietaryRestrictions.filter((restriction) =>
    activeMenuItems.some((item) => item.dietaryTags.includes(restriction))
  );
  const dietaryRequirementsUnsupported = criteria.dietaryRestrictions.filter(
    (restriction) => !dietaryRequirementsSupported.includes(restriction)
  );
  const eventStyleSupported = caterer.supportedEventStyles.includes(criteria.eventStyle);
  const locationSupported = locationMatcher.canServe({
    catererLocation: caterer.location,
    serviceAreas: caterer.serviceAreas,
    requestedLocation: criteria.location
  });
  const fulfillmentSupported = supportsFulfillment(
    caterer.fulfillmentMethod,
    criteria.fulfillmentMethod
  );

  return {
    available: availability.available,
    availabilityReason: availability.reason,
    budgetPlausible,
    minimumEstimatedTotal:
      minimumEstimatedCents === null ? null : centsToMoney(minimumEstimatedCents),
    cuisineMatch,
    matchedCuisines,
    requestedDishesAvailable,
    requestedDishesUnavailable,
    capacitySupported: availability.reason !== "CAPACITY_EXCEEDED",
    eventStyleSupported,
    dietaryRequirementsSupported,
    dietaryRequirementsUnsupported,
    locationSupported,
    fulfillmentSupported
  };
}

export function isFullCatererMatch(
  criteria: CateringRequest,
  match: CatererMatch
): boolean {
  return (
    match.available &&
    match.budgetPlausible &&
    match.cuisineMatch &&
    match.requestedDishesUnavailable.length === 0 &&
    match.capacitySupported &&
    match.eventStyleSupported &&
    match.dietaryRequirementsUnsupported.length === 0 &&
    match.locationSupported &&
    match.fulfillmentSupported &&
    (criteria.dishes.length === 0 || match.requestedDishesAvailable.length > 0)
  );
}
