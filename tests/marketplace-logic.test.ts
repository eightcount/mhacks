import { describe, expect, it } from "vitest";
import type { Availability, Caterer, CateringRequest, MenuItem } from "../src/types/domain.js";
import { assertCatererOwnership } from "../src/services/authorization.js";
import { DomainError } from "../src/services/errors.js";
import { exactLocationMatcher } from "../src/services/location.js";
import {
  evaluateCatererMatch,
  isFullCatererMatch,
  type CatererSearchCandidate
} from "../src/services/matching.js";
import { calculateOrderTotal } from "../src/services/money.js";
import { assertOrderTransition, canTransitionOrder } from "../src/services/order-state.js";
import {
  createOrderSchema,
  updateCatererSettingsSchema,
  updateMenuItemSchema
} from "../src/validation/index.js";

const caterer = {
  id: "22000000-0000-4000-8000-000000000001",
  ownerUserId: "11000000-0000-4000-8000-000000000001",
  businessName: "Test Chinese Caterer",
  description: "A fictional test caterer.",
  cuisineTypes: ["CHINESE"],
  location: "Ann Arbor, MI",
  serviceAreas: ["Ypsilanti, MI"],
  serviceRadius: 20,
  minimumOrder: "150.00",
  maximumCapacity: 70,
  supportedEventStyles: ["BUFFET", "CASUAL"],
  fulfillmentMethod: "DELIVERY",
  deliveryRadius: 20,
  deliveryFee: "25.00",
  minimumDeliveryOrder: "150.00",
  active: true,
  createdAt: new Date(),
  updatedAt: new Date()
} satisfies Caterer;

const availabilityEntry = {
  id: "88000000-0000-4000-8000-000000000001",
  catererId: caterer.id,
  date: "2030-06-15",
  available: true,
  capacityOverride: 50,
  createdAt: new Date(),
  updatedAt: new Date()
} satisfies Availability;

const menuItems = [
  {
    id: "33000000-0000-4000-8000-000000000001",
    catererId: caterer.id,
    name: "Vegetable Dumplings",
    description: "Test item.",
    price: "11.50",
    dietaryTags: ["VEGETARIAN", "VEGAN"],
    active: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    id: "33000000-0000-4000-8000-000000000002",
    catererId: caterer.id,
    name: "Five-Spice Chicken",
    description: "Test item.",
    price: "13.50",
    dietaryTags: [],
    active: true,
    createdAt: new Date(),
    updatedAt: new Date()
  }
] satisfies MenuItem[];

const candidate: CatererSearchCandidate = { caterer, menuItems, availabilityEntry };

const baseRequest: CateringRequest = {
  eventDate: "2030-06-15",
  budget: "450.00",
  cuisines: ["chinese"],
  dishes: ["DUMPLINGS"],
  headcount: 30,
  eventStyle: "BUFFET",
  dietaryRestrictions: ["VEGETARIAN"],
  location: "ann arbor, mi",
  fulfillmentMethod: "DELIVERY"
};

function matches(request: CateringRequest): boolean {
  return isFullCatererMatch(request, evaluateCatererMatch(request, candidate));
}

describe("deterministic caterer matching", () => {
  it("matches a compatible combination across all eight request dimensions", () => {
    expect(matches(baseRequest)).toBe(true);
  });

  it("supports cuisine-only and dish-only requests", () => {
    expect(matches({ ...baseRequest, dishes: [] })).toBe(true);
    expect(matches({ ...baseRequest, cuisines: [] })).toBe(true);
  });

  it("filters an unavailable date", () => {
    const unavailableCandidate = {
      ...candidate,
      availabilityEntry: { ...availabilityEntry, available: false }
    };
    const match = evaluateCatererMatch(baseRequest, unavailableCandidate);
    expect(match.available).toBe(false);
    expect(match.availabilityReason).toBe("DATE_UNAVAILABLE");
  });

  it("filters a budget that cannot plausibly meet the request", () => {
    expect(matches({ ...baseRequest, budget: "300.00" })).toBe(false);
  });

  it("filters incompatible cuisine and unavailable requested dishes", () => {
    expect(matches({ ...baseRequest, cuisines: ["MEXICAN"] })).toBe(false);
    expect(matches({ ...baseRequest, dishes: ["tacos"] })).toBe(false);

    const inactiveDumplingsCandidate = {
      ...candidate,
      menuItems: [{ ...menuItems[0]!, active: false }, menuItems[1]!]
    };
    expect(
      isFullCatererMatch(
        baseRequest,
        evaluateCatererMatch(baseRequest, inactiveDumplingsCandidate)
      )
    ).toBe(false);
  });

  it("filters headcount above the availability capacity override", () => {
    expect(matches({ ...baseRequest, headcount: 51 })).toBe(false);
  });

  it("filters an unsupported event style", () => {
    expect(matches({ ...baseRequest, eventStyle: "FORMAL" })).toBe(false);
  });

  it("filters dietary requirements not supported by active menu data", () => {
    expect(matches({ ...baseRequest, dietaryRestrictions: ["HALAL"] })).toBe(false);
  });

  it("filters locations outside the deterministic service area", () => {
    expect(matches({ ...baseRequest, location: "Detroit, MI" })).toBe(false);
    expect(exactLocationMatcher.canServe({
      catererLocation: caterer.location,
      serviceAreas: caterer.serviceAreas,
      requestedLocation: "Ypsilanti, MI"
    })).toBe(true);
  });

  it("filters unsupported fulfillment methods", () => {
    expect(matches({ ...baseRequest, fulfillmentMethod: "PICKUP" })).toBe(false);
  });
});

describe("order safeguards and state transitions", () => {
  it("enforces an actor ownership boundary for caterer management", () => {
    expect(() => assertCatererOwnership(caterer, caterer.ownerUserId)).not.toThrow();
    expect(() => assertCatererOwnership(caterer, "11000000-0000-4000-8000-000000000099")).toThrow(
      DomainError
    );
  });

  it("calculates totals from stored unit prices without floating-point arithmetic", () => {
    expect(
      calculateOrderTotal([
        { quantity: 30, unitPrice: "11.50" },
        { quantity: 1, unitPrice: "25.00" }
      ])
    ).toEqual({ cents: 37_000, amount: "370.00" });
  });

  it("accepts only supported order transitions", () => {
    expect(canTransitionOrder("DRAFT", "REQUESTED")).toBe(true);
    expect(canTransitionOrder("REQUESTED", "ACCEPTED")).toBe(true);
    expect(canTransitionOrder("REQUESTED", "CANCELLED")).toBe(true);
    expect(canTransitionOrder("ACCEPTED", "COMPLETED")).toBe(true);
    expect(canTransitionOrder("DRAFT", "ACCEPTED")).toBe(false);
    expect(() => assertOrderTransition("DRAFT", "ACCEPTED")).toThrow(DomainError);
  });

  it("validates positive selected quantities and ignores client-provided totals", () => {
    const invalidQuantity = createOrderSchema.safeParse({
      customerId: "11000000-0000-4000-8000-000000000006",
      catererId: caterer.id,
      ...baseRequest,
      menuItems: [{ menuItemId: menuItems[0]!.id, quantity: 0 }],
      estimatedTotal: 0
    });
    expect(invalidQuantity.success).toBe(false);

    const validInput = createOrderSchema.parse({
      customerId: "11000000-0000-4000-8000-000000000006",
      catererId: caterer.id,
      ...baseRequest,
      menuItems: [{ menuItemId: menuItems[0]!.id, quantity: 30 }],
      estimatedTotal: 0
    });
    expect("estimatedTotal" in validInput).toBe(false);

    const duplicateItem = createOrderSchema.safeParse({
      customerId: "11000000-0000-4000-8000-000000000006",
      catererId: caterer.id,
      ...baseRequest,
      menuItems: [
        { menuItemId: menuItems[0]!.id, quantity: 15 },
        { menuItemId: menuItems[0]!.id, quantity: 15 }
      ]
    });
    expect(duplicateItem.success).toBe(false);
  });

  it("validates caterer settings and menu mutation inputs", () => {
    expect(updateCatererSettingsSchema.safeParse({ supportedEventStyles: [] }).success).toBe(false);
    expect(updateMenuItemSchema.safeParse({ price: -1 }).success).toBe(false);
    expect(updateMenuItemSchema.safeParse({ active: false }).success).toBe(true);
  });
});
