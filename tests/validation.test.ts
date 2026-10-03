import { describe, expect, it } from "vitest";
import { dietaryTags, orderStatuses, userRoles } from "../src/types/domain.js";
import {
  createCatererSchema,
  createMenuItemSchema,
  createOrderSchema
} from "../src/validation/index.js";

const ownerUserId = "11000000-0000-4000-8000-000000000001";
const catererId = "22000000-0000-4000-8000-000000000001";
const customerId = "11000000-0000-4000-8000-000000000006";

const validCaterer = {
  ownerUserId,
  businessName: "Test Kitchen",
  description: "A fictional test caterer.",
  cuisineTypes: ["CHINESE"],
  location: "Test District",
  serviceRadius: 10,
  minimumOrder: 100,
  maximumCapacity: 50,
  supportedEventStyles: ["CASUAL"] as const,
  fulfillmentMethod: "PICKUP" as const
};

const validMenuItem = {
  catererId,
  name: "Test Noodles",
  description: "A fictional menu item.",
  price: 12,
  dietaryTags: ["VEGAN"] as const
};

const validOrder = {
  customerId,
  catererId,
  eventDate: "2030-06-15",
  headcount: 20,
  budget: 300,
  dishes: [],
  cuisines: ["CHINESE"],
  eventStyle: "CASUAL" as const,
  dietaryRestrictions: [],
  location: "Test District",
  fulfillmentMethod: "PICKUP" as const,
  menuItems: [
    {
      menuItemId: "33000000-0000-4000-8000-000000000001",
      quantity: 20
    }
  ]
};

describe("foundational validation", () => {
  it("rejects an invalid guest count", () => {
    expect(createOrderSchema.safeParse({ ...validOrder, headcount: 0 }).success).toBe(false);
  });

  it("rejects a negative menu item price", () => {
    expect(createMenuItemSchema.safeParse({ ...validMenuItem, price: -0.01 }).success).toBe(false);
  });

  it("rejects a negative order budget", () => {
    expect(createOrderSchema.safeParse({ ...validOrder, budget: -1 }).success).toBe(false);
  });

  it("requires the essential caterer fields", () => {
    expect(createCatererSchema.safeParse({ ...validCaterer, businessName: "" }).success).toBe(false);
    expect(createCatererSchema.safeParse({ ...validCaterer, maximumCapacity: 0 }).success).toBe(false);
  });

  it("requires an essential menu item field", () => {
    expect(createMenuItemSchema.safeParse({ ...validMenuItem, name: "" }).success).toBe(false);
  });

  it("exposes the domain enum values used by validation and storage", () => {
    expect(userRoles).toEqual(["CUSTOMER", "CATERER"]);
    expect(orderStatuses).toContain("REQUESTED");
    expect(dietaryTags).toContain("VEGETARIAN");
  });
});
