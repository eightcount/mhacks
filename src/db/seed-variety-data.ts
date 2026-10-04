import type { DietaryTag, EventStyle, OrderStatus } from "../types/domain.js";
import type { ProductSpec } from "../validation/caterer-operations.js";
import { dashboardCustomers, demoCustomerId, offsetSeedDate, seedId } from "./seed-data.js";

// Every name, venue, and messaging identifier below is fictional. Contacts are
// test identifiers, never phone numbers or email addresses.

const caterer = {
  jade: "22000000-0000-4000-8000-000000000001",
  cactus: "22000000-0000-4000-8000-000000000002",
  verdant: "22000000-0000-4000-8000-000000000003",
  saffron: "22000000-0000-4000-8000-000000000004"
} as const;

const menu = (index: number) => seedId("33000000", index);

export const varietyCustomers = [
  "Harper Quill", "Logan Fern", "Sage Morrow", "Emerson Pike", "Finley Brook",
  "Blair Thistle", "Kai Linden", "Parker Dune", "Skyler Ridge", "Arden Moss"
].map((name, index) => ({
  id: seedId("11000000", index + 15),
  messagingIdentifier: `test:customer:variety-${index + 1}`,
  name,
  role: "CUSTOMER" as const
}));

export const varietyMenuItems = [
  { id: menu(16), catererId: caterer.jade, name: "Mushroom Mapo Tofu", description: "Silken tofu and shiitake in a numbing chili-bean sauce.", price: "12.00", dietaryTags: ["VEGETARIAN", "VEGAN"], active: true },
  { id: menu(17), catererId: caterer.jade, name: "Scallion Pancakes", description: "Flaky pan-fried pancakes with soy-vinegar dip.", price: "6.50", dietaryTags: ["VEGETARIAN"], active: true },
  { id: menu(18), catererId: caterer.jade, name: "Longevity Noodles", description: "Seasonal hand-pulled noodles; returns for the Lunar New Year.", price: "9.50", dietaryTags: ["VEGETARIAN", "VEGAN"], active: false },
  { id: menu(19), catererId: caterer.cactus, name: "Barbacoa Beef Tacos", description: "Slow-braised beef, pickled onions, and salsa verde.", price: "13.50", dietaryTags: ["GLUTEN_FREE"], active: true },
  { id: menu(20), catererId: caterer.cactus, name: "Street Corn Salad", description: "Charred corn, lime crema, and cotija.", price: "5.00", dietaryTags: ["VEGETARIAN", "GLUTEN_FREE"], active: true },
  { id: menu(21), catererId: caterer.cactus, name: "Churro Bites", description: "Cinnamon-sugar churro bites with chocolate dip.", price: "4.50", dietaryTags: ["VEGETARIAN"], active: true },
  { id: menu(22), catererId: caterer.verdant, name: "Wild Mushroom Risotto", description: "Creamy cashew risotto with roasted wild mushrooms.", price: "16.00", dietaryTags: ["VEGETARIAN", "VEGAN", "GLUTEN_FREE"], active: true },
  { id: menu(23), catererId: caterer.verdant, name: "Citrus Kale Salad", description: "Massaged kale, citrus segments, and toasted seeds.", price: "9.50", dietaryTags: ["VEGETARIAN", "VEGAN", "GLUTEN_FREE"], active: true },
  { id: menu(24), catererId: caterer.verdant, name: "Gazpacho Shooters", description: "Chilled summer tomato gazpacho; seasonal.", price: "7.00", dietaryTags: ["VEGETARIAN", "VEGAN", "GLUTEN_FREE"], active: false },
  { id: menu(25), catererId: caterer.saffron, name: "Lamb Kofta Platter", description: "Spiced lamb kofta with sumac onions and tahini.", price: "18.50", dietaryTags: ["HALAL", "GLUTEN_FREE"], active: true },
  { id: menu(26), catererId: caterer.saffron, name: "Falafel & Hummus Box", description: "Crisp falafel, hummus, pickles, and warm pita.", price: "10.50", dietaryTags: ["VEGETARIAN", "VEGAN", "HALAL"], active: true },
  { id: menu(27), catererId: caterer.saffron, name: "Pistachio Baklava", description: "Honey-soaked phyllo layered with pistachios.", price: "5.50", dietaryTags: ["VEGETARIAN"], active: true }
];

interface MenuChoice {
  id: string;
  tags: readonly DietaryTag[];
  /** False for items that are inactive today; only completed orders may include them. */
  active: boolean;
}

interface CatererVariety {
  catererId: string;
  styles: readonly EventStyle[];
  fulfillment: ReadonlyArray<"PICKUP" | "DELIVERY">;
  locations: readonly string[];
  guests: readonly [min: number, max: number];
  mains: readonly MenuChoice[];
  sides: readonly MenuChoice[];
  desserts: readonly MenuChoice[];
  /** Days from the reference date, with the order's status. */
  schedule: ReadonlyArray<readonly [offset: number, status: OrderStatus]>;
}

const V: DietaryTag = "VEGETARIAN";
const VG: DietaryTag = "VEGAN";
const GF: DietaryTag = "GLUTEN_FREE";
const H: DietaryTag = "HALAL";

const completed = (...offsets: number[]) => offsets.map((offset) => [offset, "COMPLETED"] as const);

// Each caterer has a different shape so the dashboards differ: Jade is growing,
// Copper Cactus peaked in summer, Verdant is small and steady, and Saffron books
// fewer, larger events.
export const catererVarieties: readonly CatererVariety[] = [
  {
    catererId: caterer.jade,
    styles: ["BUFFET", "FAMILY_STYLE", "CASUAL"],
    fulfillment: ["DELIVERY"],
    locations: ["Ann Arbor, MI", "Ypsilanti, MI"],
    guests: [18, 80],
    mains: [{ id: menu(1), tags: [V, VG], active: true }, { id: menu(3), tags: [], active: true }, { id: menu(16), tags: [V, VG], active: true }],
    sides: [{ id: menu(2), tags: [V, VG, GF], active: true }, { id: menu(17), tags: [V], active: true }, { id: menu(18), tags: [V, VG], active: false }],
    desserts: [],
    schedule: [
      ...completed(-168, -150, -131, -117, -103, -89, -75, -64, -55, -47, -38, -33, -26, -19, -12, -8, -3),
      [-110, "DECLINED"], [-60, "CANCELLED"], [-20, "DECLINED"],
      [2, "ACCEPTED"], [5, "REQUESTED"], [9, "ACCEPTED"], [11, "REQUESTED"], [16, "ACCEPTED"],
      [19, "DECLINED"], [23, "REQUESTED"], [27, "ACCEPTED"], [33, "CANCELLED"], [38, "DRAFT"], [44, "ACCEPTED"]
    ]
  },
  {
    catererId: caterer.cactus,
    styles: ["CASUAL", "DROP_OFF"],
    fulfillment: ["PICKUP", "DELIVERY"],
    locations: ["Ypsilanti, MI"],
    guests: [25, 130],
    mains: [{ id: menu(4), tags: [GF], active: true }, { id: menu(5), tags: [V, VG, GF], active: true }, { id: menu(19), tags: [GF], active: true }],
    sides: [{ id: menu(6), tags: [V, VG, GF], active: true }, { id: menu(20), tags: [V, GF], active: true }],
    desserts: [{ id: menu(21), tags: [V], active: true }],
    schedule: [
      ...completed(-172, -160, -146, -139, -132, -125, -118, -111, -104, -97, -90, -84, -77, -70, -58, -41, -24, -6),
      [-150, "CANCELLED"], [-95, "DECLINED"], [-45, "DECLINED"],
      [3, "REQUESTED"], [6, "ACCEPTED"], [13, "ACCEPTED"], [17, "REQUESTED"], [24, "ACCEPTED"],
      [31, "DECLINED"], [40, "REQUESTED"]
    ]
  },
  {
    catererId: caterer.verdant,
    styles: ["BUFFET", "FORMAL"],
    fulfillment: ["PICKUP"],
    locations: ["Ann Arbor, MI"],
    guests: [10, 38],
    mains: [{ id: menu(7), tags: [V, VG, GF], active: true }, { id: menu(8), tags: [V, VG, GF], active: true }, { id: menu(22), tags: [V, VG, GF], active: true }],
    sides: [{ id: menu(23), tags: [V, VG, GF], active: true }, { id: menu(24), tags: [V, VG, GF], active: false }],
    desserts: [{ id: menu(9), tags: [V, VG], active: true }],
    schedule: [
      ...completed(-165, -144, -123, -102, -81, -60, -46, -32, -18, -4),
      [-130, "DECLINED"], [-52, "CANCELLED"],
      [4, "ACCEPTED"], [10, "REQUESTED"], [18, "ACCEPTED"], [25, "REQUESTED"], [32, "REQUESTED"], [39, "DRAFT"]
    ]
  },
  {
    catererId: caterer.saffron,
    styles: ["FORMAL", "FAMILY_STYLE"],
    fulfillment: ["DELIVERY"],
    locations: ["Detroit, MI"],
    guests: [30, 100],
    mains: [{ id: menu(10), tags: [H, GF], active: true }, { id: menu(25), tags: [H, GF], active: true }, { id: menu(26), tags: [V, VG, H], active: true }],
    sides: [{ id: menu(11), tags: [V, VG], active: true }, { id: menu(12), tags: [V, VG], active: true }],
    desserts: [{ id: menu(27), tags: [V], active: true }],
    schedule: [
      ...completed(-170, -142, -128, -100, -86, -72, -35, -14),
      [-115, "CANCELLED"], [-65, "DECLINED"], [-50, "DECLINED"],
      [7, "ACCEPTED"], [12, "ACCEPTED"], [15, "REQUESTED"], [20, "ACCEPTED"], [26, "REQUESTED"],
      [29, "REQUESTED"], [36, "CANCELLED"]
    ]
  }
];

const customerPool = [demoCustomerId, ...dashboardCustomers.map((customer) => customer.id), ...varietyCustomers.map((customer) => customer.id)];

const dietaryCycle: readonly DietaryTag[][] = [
  [], [V], [], [GF], [], [VG], [], [H], [V, GF], []
];

const specialRequests = [
  null,
  "Please label every tray with its dietary tags.",
  "Setup by 11:30; lunch starts at noon.",
  null,
  "Extra serving utensils, please.",
  "Birthday celebration; a small sign would be lovely.",
  "Office lunch: individually labeled boxes preferred.",
  null,
  "Two guests have severe nut allergies.",
  "Can the food arrive warm? There is no way to reheat on site.",
  "Outdoor event; please pack ice for the cold items.",
  null
];

/** Side portions as a fraction of the guest count. */
const sideRatios = [[1, 1], [3, 4], [1, 2]] as const;

export interface VarietyOrderLine {
  menuItemId: string;
  quantity: number;
}

export interface VarietyOrderPlan {
  id: string;
  catererId: string;
  customerId: string;
  eventDate: string;
  guestCount: number;
  status: OrderStatus;
  eventStyle: EventStyle;
  fulfillmentMethod: "PICKUP" | "DELIVERY";
  eventLocation: string;
  dietaryRestrictions: DietaryTag[];
  specialRequests: string | null;
  lines: VarietyOrderLine[];
  /** Extra budget above the calculated total, in cents. */
  budgetHeadroomCents: number;
  /** Days between the request and the event, used by `orderTimeline`. */
  leadDays: number;
}

function rotate<T>(values: readonly T[], start: number): T[] {
  return values.map((_, index) => values[(start + index) % values.length]!);
}

function satisfies(choice: MenuChoice, restrictions: readonly DietaryTag[]): boolean {
  return restrictions.every((tag) => choice.tags.includes(tag));
}

/**
 * Builds deterministic, varied catering orders. IDs are stable, so repeat seed
 * runs add only missing orders. The seed may move an event date by a few days
 * to avoid a closed or already-booked date, and then recalculates timestamps.
 */
export function buildVarietyOrderPlans(referenceDate: string): VarietyOrderPlan[] {
  const plans: VarietyOrderPlan[] = [];
  for (const [ci, variety] of catererVarieties.entries()) {
    const regular = customerPool[(ci * 5 + 2) % customerPool.length]!;
    for (const [k, [offset, status]] of variety.schedule.entries()) {
      const allowInactive = status === "COMPLETED";
      const usable = (choice: MenuChoice) => choice.active || allowInactive;
      const wanted = dietaryCycle[(k * 3 + ci) % dietaryCycle.length]!;
      const restrictions = variety.mains.some((choice) => usable(choice) && satisfies(choice, wanted))
        ? wanted : [];
      const pick = (choices: readonly MenuChoice[], start: number) =>
        rotate(choices, start).find((choice) => usable(choice) && satisfies(choice, restrictions));

      const [minGuests, maxGuests] = variety.guests;
      const guestCount = minGuests + ((k * 23 + ci * 17 + 7) % (maxGuests - minGuests + 1));
      const [numerator, denominator] = sideRatios[k % sideRatios.length]!;
      const main = pick(variety.mains, k)!;
      const side = k % 4 === 3 ? undefined : pick(variety.sides, k);
      const dessert = k % 3 === 0 ? pick(variety.desserts, 0) : undefined;
      const lines: VarietyOrderLine[] = [{ menuItemId: main.id, quantity: guestCount }];
      if (side) lines.push({ menuItemId: side.id, quantity: Math.ceil((guestCount * numerator) / denominator) });
      if (dessert) lines.push({ menuItemId: dessert.id, quantity: guestCount });

      const fulfillmentMethod = variety.fulfillment[(k * 2 + ci) % variety.fulfillment.length]!;
      plans.push({
        id: seedId("44000000", 101 + plans.length),
        catererId: variety.catererId,
        customerId: k % 4 === 1 ? regular : customerPool[(k * 7 + ci * 3) % customerPool.length]!,
        eventDate: offsetSeedDate(referenceDate, offset),
        guestCount,
        status,
        eventStyle: variety.styles[(k + ci) % variety.styles.length]!,
        fulfillmentMethod,
        eventLocation: variety.locations[k % variety.locations.length]!,
        dietaryRestrictions: [...restrictions],
        specialRequests: specialRequests[(k * 5 + ci) % specialRequests.length]!,
        lines,
        budgetHeadroomCents: Math.floor(((k * 3_700 + ci * 1_900) % 25_000) / 100) * 100,
        leadDays: 5 + ((k * 7 + ci * 3) % 26)
      });
    }
  }
  return plans;
}

function earlier(left: string, right: string): string {
  return left < right ? left : right;
}

/**
 * Request and last-update times consistent with an order's lifecycle: every
 * order was requested before the reference date, and completed orders were
 * updated on their event date.
 */
export function orderTimeline(
  eventDate: string,
  status: OrderStatus,
  referenceDate: string,
  leadDays: number
): { createdAt: Date; updatedAt: Date } {
  const yesterday = offsetSeedDate(referenceDate, -1);
  const created = status === "DRAFT"
    ? yesterday
    : earlier(offsetSeedDate(eventDate, -leadDays), yesterday);
  const updateAfter: Partial<Record<OrderStatus, number>> = { ACCEPTED: 1, DECLINED: 1, CANCELLED: 3 };
  const updated = status === "COMPLETED"
    ? eventDate
    : earlier(earlier(offsetSeedDate(created, updateAfter[status] ?? 0), yesterday), eventDate);
  return {
    createdAt: new Date(`${created}T15:00:00.000Z`),
    updatedAt: new Date(`${updated}T${status === "COMPLETED" ? "21" : "16"}:00:00.000Z`)
  };
}

// Caterer operations: recipes, order forms, preorders, and notifications.

const fill = (amount: string, unit: "g" | "kg" | "ml" | "l" | "each") => ({ amount, unit });

function recipe(
  menuItemId: string,
  container: { name: string; capacity: ProductSpec["container"]["capacity"]; fill: ProductSpec["container"]["fill"] },
  name: string,
  yieldMeasure: ProductSpec["recipe"]["yield"],
  ingredients: Array<[string, string, "g" | "kg" | "ml" | "l" | "each"]>,
  allergens: string[],
  storageInstructions: string
): ProductSpec {
  return {
    menuItemId,
    container,
    recipe: {
      name,
      yield: yieldMeasure,
      ingredients: ingredients.map(([ingredient, amount, unit]) => ({ name: ingredient, measure: { amount, unit } })),
      allergens,
      storageInstructions
    }
  };
}

export const varietyProductSpecs = [
  { key: "dumplings", catererId: caterer.jade, spec: recipe(menu(1), { name: "12-piece dumpling box", capacity: fill("12", "each"), fill: fill("12", "each") }, "Vegetable dumplings", fill("60", "each"), [["All-purpose flour", "500", "g"], ["Napa cabbage", "600", "g"], ["Shiitake mushrooms", "250", "g"], ["Fresh ginger", "30", "g"], ["Soy sauce", "60", "ml"], ["Sesame oil", "20", "ml"]], ["wheat", "soy", "sesame"], "Keep refrigerated. Steam 8 to 10 minutes before serving.") },
  { key: "friedRice", catererId: caterer.jade, spec: recipe(menu(2), { name: "32 oz deli container", capacity: fill("950", "ml"), fill: fill("900", "ml") }, "Ginger scallion fried rice", fill("7.2", "l"), [["Jasmine rice", "2", "kg"], ["Scallions", "300", "g"], ["Fresh ginger", "80", "g"], ["Seasonal greens", "600", "g"], ["Neutral oil", "150", "ml"], ["Soy sauce", "120", "ml"]], ["soy"], "Refrigerate within 2 hours. Reheat until steaming.") },
  { key: "pancakes", catererId: caterer.jade, spec: recipe(menu(17), { name: "Pancake sleeve", capacity: fill("4", "each"), fill: fill("4", "each") }, "Scallion pancakes", fill("24", "each"), [["All-purpose flour", "1", "kg"], ["Scallions", "250", "g"], ["Water", "600", "ml"], ["Sesame oil", "40", "ml"]], ["wheat", "sesame"], "Re-crisp in a dry pan or 400°F oven for 5 minutes.") },
  { key: "tacos", catererId: caterer.cactus, spec: recipe(menu(4), { name: "Taco kit tray", capacity: fill("6", "each"), fill: fill("6", "each") }, "Citrus chicken tacos", fill("48", "each"), [["Chicken thighs", "3", "kg"], ["Corn tortillas", "48", "each"], ["Oranges", "6", "each"], ["Limes", "8", "each"], ["White onion", "400", "g"], ["Cilantro", "60", "g"]], [], "Keep chicken refrigerated; warm tortillas just before serving.") },
  { key: "rice", catererId: caterer.cactus, spec: recipe(menu(6), { name: "16 oz container", capacity: fill("475", "ml"), fill: fill("450", "ml") }, "Cilantro lime rice", fill("5.4", "l"), [["Long-grain rice", "1.5", "kg"], ["Limes", "6", "each"], ["Cilantro", "80", "g"], ["Vegetable stock", "2", "l"]], [], "Refrigerate within 2 hours. Reheat until steaming.") },
  { key: "churros", catererId: caterer.cactus, spec: recipe(menu(21), { name: "Churro bag", capacity: fill("12", "each"), fill: fill("12", "each") }, "Churro bites", fill("96", "each"), [["All-purpose flour", "750", "g"], ["Sugar", "300", "g"], ["Cinnamon", "30", "g"], ["Eggs", "6", "each"], ["Butter", "200", "g"]], ["wheat", "egg", "milk"], "Best the same day. Re-crisp at 350°F for 4 minutes.") },
  { key: "pilaf", catererId: caterer.verdant, spec: recipe(menu(8), { name: "Compostable bowl", capacity: fill("500", "g"), fill: fill("450", "g") }, "Smoky lentil pilaf", fill("6.3", "kg"), [["Green lentils", "1.5", "kg"], ["Brown rice", "1.2", "kg"], ["Smoked paprika", "40", "g"], ["Toasted seeds", "300", "g"], ["Vegetable stock", "3", "l"]], [], "Refrigerate. Serve warm or at room temperature.") },
  { key: "squares", catererId: caterer.verdant, spec: recipe(menu(9), { name: "6-square box", capacity: fill("6", "each"), fill: fill("6", "each") }, "Berry oat squares", fill("36", "each"), [["Rolled oats", "900", "g"], ["Mixed berries", "1.2", "kg"], ["Coconut oil", "250", "g"], ["Maple syrup", "300", "ml"]], ["oats", "coconut"], "Keep cool and covered for up to 3 days.") },
  { key: "skewers", catererId: caterer.saffron, spec: recipe(menu(10), { name: "Skewer tray", capacity: fill("10", "each"), fill: fill("10", "each") }, "Herb chicken skewers", fill("50", "each"), [["Chicken breast", "4", "kg"], ["Greek yogurt", "1", "kg"], ["Lemons", "8", "each"], ["Garlic", "120", "g"], ["Fresh herbs", "150", "g"]], ["milk"], "Keep refrigerated. Reheat covered at 350°F for 10 minutes.") },
  { key: "falafel", catererId: caterer.saffron, spec: recipe(menu(26), { name: "Mezze box", capacity: fill("1", "each"), fill: fill("1", "each") }, "Falafel and hummus box", fill("20", "each"), [["Dried chickpeas", "2", "kg"], ["Tahini", "500", "g"], ["Parsley", "200", "g"], ["Pita", "20", "each"]], ["sesame", "wheat"], "Keep hummus chilled; warm falafel and pita before serving.") },
  { key: "baklava", catererId: caterer.saffron, spec: recipe(menu(27), { name: "Baklava tin", capacity: fill("16", "each"), fill: fill("16", "each") }, "Pistachio baklava", fill("64", "each"), [["Phyllo dough", "1", "kg"], ["Pistachios", "800", "g"], ["Butter", "600", "g"], ["Honey", "500", "ml"]], ["wheat", "tree nuts", "milk"], "Store covered at room temperature for up to 5 days.") }
].map((entry, index) => ({ ...entry, id: seedId("8a000000", index + 1) }));

export type VarietyProductKey = (typeof varietyProductSpecs)[number]["key"];

export const preorderCustomers = [
  { name: "Harper Quill", address: "Larkspur Commons, Unit 4" },
  { name: "Logan Fern", address: "Willowbend Office Park, Suite 140" },
  { name: "Maple Hollow Book Club", address: "Maple Hollow Clubhouse" },
  { name: "Sage Morrow", address: "Cedar Row Studios, Loft 2" },
  { name: "Emerson Pike", address: "Juniper Court, Building B" },
  { name: "Foxglove Lane Co-op", address: "Foxglove Lane Co-op, Common Room" },
  { name: "Finley Brook", address: "Larkspur Commons, Unit 11" },
  { name: "Blair Thistle", address: "Willowbend Office Park, Suite 210" },
  { name: "Kai Linden", address: "Birchwood Lofts, Apartment 3C" },
  { name: "Parker Dune", address: "Juniper Court, Building D" },
  { name: "Dana Cloud", address: "Cedar Row Studios, Loft 7" },
  { name: "Quinn Hollow", address: "Thornberry Hall, Room 12" }
].map((customer, index) => ({ ...customer, contact: `test:customer:preorder-${index + 1}` }));

type PreorderEntry = readonly [customer: number, status: OrderStatus, quantities: readonly number[]];

interface VarietyFormPlan {
  id: string;
  catererId: string;
  title: string;
  /** Days from the reference date. */
  fulfillmentOffset: number;
  /** Days from the reference date; the form closes at 22:00 UTC that day. */
  closesOffset: number;
  fulfillmentMethod: "PICKUP" | "DELIVERY";
  fulfillmentInstructions: string;
  /** Customer notification wording, e.g. "between 4 and 7 pm". */
  window: string;
  minimumOrder: string;
  deliveryFee: string;
  active: boolean;
  products: ReadonlyArray<readonly [key: VarietyProductKey, maxPackages: number]>;
  preorders: readonly PreorderEntry[];
}

const formPlans: Array<Omit<VarietyFormPlan, "id">> = [
  {
    catererId: caterer.jade, title: "Mid-Autumn dumpling drop", window: "between 4 and 7 pm", fulfillmentOffset: -17, closesOffset: -20,
    fulfillmentMethod: "DELIVERY", fulfillmentInstructions: "Deliveries between 4 and 7 pm in Ann Arbor and Ypsilanti.",
    minimumOrder: "20.00", deliveryFee: "6.00", active: true,
    products: [["dumplings", 40], ["friedRice", 30]],
    preorders: [[0, "COMPLETED", [3, 2]], [1, "COMPLETED", [6, 4]], [2, "COMPLETED", [10, 6]], [4, "COMPLETED", [2, 0]], [6, "CANCELLED", [4, 2]], [8, "COMPLETED", [5, 3]], [9, "DECLINED", [12, 0]]]
  },
  {
    catererId: caterer.jade, title: "Weeknight dumpling & noodle drop", window: "between 5 and 7 pm", fulfillmentOffset: 6, closesOffset: 4,
    fulfillmentMethod: "DELIVERY", fulfillmentInstructions: "Deliveries between 5 and 7 pm. Leave-at-door is fine.",
    minimumOrder: "25.00", deliveryFee: "6.00", active: true,
    products: [["dumplings", 36], ["friedRice", 24], ["pancakes", 20]],
    preorders: [[0, "ACCEPTED", [4, 2, 2]], [3, "ACCEPTED", [6, 3, 0]], [5, "ACCEPTED", [8, 4, 6]], [7, "REQUESTED", [3, 0, 2]], [10, "REQUESTED", [2, 2, 0]], [11, "DECLINED", [10, 0, 0]], [1, "REQUESTED", [5, 3, 4]]]
  },
  {
    catererId: caterer.jade, title: "Holiday party trays", window: "between 11 am and 2 pm", fulfillmentOffset: 20, closesOffset: 16,
    fulfillmentMethod: "DELIVERY", fulfillmentInstructions: "Deliveries between 11 am and 2 pm for office parties.",
    minimumOrder: "40.00", deliveryFee: "8.00", active: true,
    products: [["dumplings", 60], ["pancakes", 40]],
    preorders: [[2, "REQUESTED", [12, 8]], [5, "ACCEPTED", [8, 6]]]
  },
  {
    catererId: caterer.cactus, title: "Taco Tuesday kits", window: "for pickup between 4 and 6 pm", fulfillmentOffset: -13, closesOffset: -15,
    fulfillmentMethod: "PICKUP", fulfillmentInstructions: "Pick up at the Ypsilanti kitchen between 4 and 6 pm.",
    minimumOrder: "0.00", deliveryFee: "0.00", active: true,
    products: [["tacos", 50], ["rice", 40]],
    preorders: [[1, "COMPLETED", [4, 3]], [3, "COMPLETED", [2, 2]], [5, "COMPLETED", [8, 6]], [7, "COMPLETED", [3, 0]], [9, "CANCELLED", [5, 5]], [10, "COMPLETED", [6, 4]], [11, "COMPLETED", [2, 1]]]
  },
  {
    catererId: caterer.cactus, title: "Game-day taco kits", window: "for pickup between 10 am and noon", fulfillmentOffset: 2, closesOffset: -1,
    fulfillmentMethod: "PICKUP", fulfillmentInstructions: "Pick up before kickoff, between 10 am and noon.",
    minimumOrder: "0.00", deliveryFee: "0.00", active: true,
    products: [["tacos", 60], ["rice", 45], ["churros", 40]],
    preorders: [[0, "ACCEPTED", [10, 8, 6]], [2, "ACCEPTED", [12, 10, 8]], [4, "ACCEPTED", [8, 6, 4]], [6, "ACCEPTED", [14, 9, 10]], [8, "ACCEPTED", [9, 6, 6]], [10, "REQUESTED", [5, 4, 4]], [11, "CANCELLED", [6, 0, 0]]]
  },
  {
    catererId: caterer.cactus, title: "Fiesta Friday delivery", window: "between 5 and 8 pm", fulfillmentOffset: 9, closesOffset: 7,
    fulfillmentMethod: "DELIVERY", fulfillmentInstructions: "Deliveries between 5 and 8 pm within Ypsilanti.",
    minimumOrder: "30.00", deliveryFee: "5.00", active: true,
    products: [["tacos", 30], ["churros", 30]],
    preorders: [[1, "REQUESTED", [4, 2]], [3, "ACCEPTED", [6, 3]], [7, "REQUESTED", [3, 3]]]
  },
  {
    catererId: caterer.verdant, title: "Harvest supper boxes", window: "for pickup between 5 and 7 pm", fulfillmentOffset: -10, closesOffset: -12,
    fulfillmentMethod: "PICKUP", fulfillmentInstructions: "Pick up at the Ann Arbor studio kitchen, 5 to 7 pm.",
    minimumOrder: "15.00", deliveryFee: "0.00", active: true,
    products: [["pilaf", 24], ["squares", 20]],
    preorders: [[2, "COMPLETED", [6, 4]], [4, "COMPLETED", [2, 1]], [5, "COMPLETED", [8, 6]], [8, "COMPLETED", [3, 2]], [9, "DECLINED", [4, 0]]]
  },
  {
    catererId: caterer.verdant, title: "Sunday meal-prep pickup", window: "for pickup between 10 am and 1 pm", fulfillmentOffset: 5, closesOffset: 3,
    fulfillmentMethod: "PICKUP", fulfillmentInstructions: "Pick up Sunday between 10 am and 1 pm.",
    minimumOrder: "15.00", deliveryFee: "0.00", active: true,
    products: [["pilaf", 20], ["squares", 18]],
    preorders: [[0, "ACCEPTED", [5, 3]], [3, "ACCEPTED", [4, 2]], [6, "REQUESTED", [3, 1]], [9, "REQUESTED", [6, 4]]]
  },
  {
    catererId: caterer.verdant, title: "Winter soup club (paused)", window: "for pickup between 5 and 7 pm", fulfillmentOffset: 30, closesOffset: 25,
    fulfillmentMethod: "PICKUP", fulfillmentInstructions: "Pick up at the studio kitchen, 5 to 7 pm.",
    minimumOrder: "15.00", deliveryFee: "0.00", active: false,
    products: [["pilaf", 10]],
    preorders: []
  },
  {
    catererId: caterer.saffron, title: "Friday mezze night", window: "between 6 and 8 pm", fulfillmentOffset: -24, closesOffset: -26,
    fulfillmentMethod: "DELIVERY", fulfillmentInstructions: "Deliveries between 6 and 8 pm in Detroit.",
    minimumOrder: "30.00", deliveryFee: "7.50", active: true,
    products: [["skewers", 30], ["falafel", 40]],
    preorders: [[0, "COMPLETED", [3, 4]], [2, "COMPLETED", [6, 10]], [5, "COMPLETED", [4, 6]], [7, "CANCELLED", [2, 2]], [11, "COMPLETED", [2, 3]]]
  },
  {
    catererId: caterer.saffron, title: "Eid celebration platters", window: "between noon and 3 pm", fulfillmentOffset: -6, closesOffset: -9,
    fulfillmentMethod: "DELIVERY", fulfillmentInstructions: "Deliveries between noon and 3 pm in Detroit.",
    minimumOrder: "40.00", deliveryFee: "7.50", active: true,
    products: [["skewers", 40], ["falafel", 40], ["baklava", 25]],
    preorders: [[1, "COMPLETED", [8, 6, 5]], [3, "COMPLETED", [10, 8, 6]], [4, "COMPLETED", [6, 10, 4]], [6, "COMPLETED", [12, 12, 8]], [8, "COMPLETED", [4, 4, 2]], [10, "DECLINED", [6, 0, 0]]]
  },
  {
    catererId: caterer.saffron, title: "Weekend mezze delivery", window: "between 5 and 8 pm", fulfillmentOffset: 8, closesOffset: 6,
    fulfillmentMethod: "DELIVERY", fulfillmentInstructions: "Deliveries between 5 and 8 pm in Detroit.",
    minimumOrder: "30.00", deliveryFee: "7.50", active: true,
    products: [["skewers", 30], ["falafel", 35], ["baklava", 20]],
    preorders: [[0, "ACCEPTED", [5, 6, 4]], [2, "ACCEPTED", [8, 10, 6]], [4, "REQUESTED", [3, 4, 2]], [6, "ACCEPTED", [6, 6, 6]], [9, "REQUESTED", [4, 0, 2]], [11, "CANCELLED", [3, 3, 0]]]
  }
];

export interface VarietyForm {
  id: string;
  catererId: string;
  title: string;
  fulfillmentDate: string;
  closesAt: Date;
  fulfillmentMethod: "PICKUP" | "DELIVERY";
  fulfillmentInstructions: string;
  minimumOrder: string;
  deliveryFee: string;
  active: boolean;
  createdAt: Date;
  products: Array<{ productSpecId: string; maxPackages: number }>;
}

export interface VarietyPreorder {
  id: string;
  formId: string;
  catererId: string;
  submissionId: string;
  customerName: string;
  customerContact: string;
  deliveryAddress: string;
  status: OrderStatus;
  items: Array<{ productSpecId: string; quantity: number }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface VarietyNotification {
  id: string;
  orderId: string;
  catererId: string;
  status: "DRAFT" | "SENT" | "FAILED";
  deliveryWindow: string;
  note: string;
  updatedAt: Date;
}

const specIdByKey = new Map(varietyProductSpecs.map((entry) => [entry.key, entry.id]));

function at(date: string, hour: number): Date {
  return new Date(`${date}T${String(hour).padStart(2, "0")}:00:00.000Z`);
}

/** Order forms, preorders, and notifications relative to the reference date. */
export function buildVarietyOperations(referenceDate: string) {
  const forms: VarietyForm[] = [];
  const preorders: VarietyPreorder[] = [];
  const notifications: VarietyNotification[] = [];
  const yesterday = offsetSeedDate(referenceDate, -1);

  for (const [formIndex, plan] of formPlans.entries()) {
    const id = seedId("8b000000", formIndex + 1);
    const fulfillmentDate = offsetSeedDate(referenceDate, plan.fulfillmentOffset);
    const opened = offsetSeedDate(referenceDate, Math.min(plan.closesOffset, 0) - 10);
    forms.push({
      id,
      catererId: plan.catererId,
      title: plan.title,
      fulfillmentDate,
      closesAt: at(offsetSeedDate(referenceDate, plan.closesOffset), 22),
      fulfillmentMethod: plan.fulfillmentMethod,
      fulfillmentInstructions: plan.fulfillmentInstructions,
      minimumOrder: plan.minimumOrder,
      deliveryFee: plan.deliveryFee,
      active: plan.active,
      createdAt: at(opened, 14),
      products: plan.products.map(([key, maxPackages]) => ({ productSpecId: specIdByKey.get(key)!, maxPackages }))
    });

    for (const [entryIndex, [customerIndex, status, quantities]] of plan.preorders.entries()) {
      const customer = preorderCustomers[customerIndex]!;
      const sequence = preorders.length + 1;
      const submitted = earlier(offsetSeedDate(opened, entryIndex + 1), yesterday);
      const decided = status === "COMPLETED" ? fulfillmentDate : earlier(offsetSeedDate(submitted, 1), yesterday);
      const preorder: VarietyPreorder = {
        id: seedId("8c000000", sequence),
        formId: id,
        catererId: plan.catererId,
        submissionId: seedId("8e000000", sequence),
        customerName: customer.name,
        customerContact: customer.contact,
        deliveryAddress: plan.fulfillmentMethod === "DELIVERY" ? customer.address : "",
        status,
        items: plan.products
          .map(([key], index) => ({ productSpecId: specIdByKey.get(key)!, quantity: quantities[index] ?? 0 }))
          .filter((item) => item.quantity > 0),
        createdAt: at(submitted, 16),
        updatedAt: at(status === "REQUESTED" ? submitted : decided, status === "REQUESTED" ? 16 : 18)
      };
      preorders.push(preorder);

      // Past forms: confirmations were sent, with an occasional failed delivery.
      // Upcoming forms: the first confirmation was sent and others await review.
      const isPast = plan.fulfillmentOffset < 0;
      const notify = status === "COMPLETED" || (status === "ACCEPTED" && entryIndex % 2 === 0);
      if (!notify) continue;
      const failed = entryIndex === 1 && formIndex % 2 === 0;
      notifications.push({
        id: seedId("8d000000", notifications.length + 1),
        orderId: preorder.id,
        catererId: plan.catererId,
        status: isPast ? (failed ? "FAILED" : "SENT") : entryIndex === 0 ? "SENT" : "DRAFT",
        deliveryWindow: plan.window,
        note: isPast ? "Thank you for ordering!" : "Reply here if anything changes.",
        updatedAt: isPast ? at(offsetSeedDate(fulfillmentDate, -1), 15) : at(yesterday, 17)
      });
    }
  }
  return { forms, preorders, notifications };
}
