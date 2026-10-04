import { and, eq, inArray } from "drizzle-orm";
import { closeDatabaseConnection, db } from "./index.js";
import {
  availability,
  cateringRequestStates,
  caterers,
  conversations,
  menuItems,
  messages,
  orderItems,
  orders,
  users
} from "./schema/index.js";
import { calculateOrderTotal, centsToMoney, moneyToCents } from "../services/money.js";
import { assertOrderTransition } from "../services/order-state.js";
import { assessAvailability } from "../services/matching.js";
import {
  buildDashboardOrderPlans,
  dashboardCustomers,
  demoCatererIds,
  offsetSeedDate,
  seedId
} from "./seed-data.js";
import { seedVarietyFixtures } from "./seed-variety.js";

const ids = {
  jadeOwner: "11000000-0000-4000-8000-000000000001",
  cactusOwner: "11000000-0000-4000-8000-000000000002",
  verdantOwner: "11000000-0000-4000-8000-000000000003",
  saffronOwner: "11000000-0000-4000-8000-000000000004",
  seoulOwner: "11000000-0000-4000-8000-000000000005",
  customer: "11000000-0000-4000-8000-000000000006",
  jade: "22000000-0000-4000-8000-000000000001",
  cactus: "22000000-0000-4000-8000-000000000002",
  verdant: "22000000-0000-4000-8000-000000000003",
  saffron: "22000000-0000-4000-8000-000000000004",
  seoul: "22000000-0000-4000-8000-000000000005",
  jadeMenuOne: "33000000-0000-4000-8000-000000000001",
  jadeMenuTwo: "33000000-0000-4000-8000-000000000002",
  jadeMenuThree: "33000000-0000-4000-8000-000000000003",
  cactusMenuOne: "33000000-0000-4000-8000-000000000004",
  cactusMenuTwo: "33000000-0000-4000-8000-000000000005",
  cactusMenuThree: "33000000-0000-4000-8000-000000000006",
  verdantMenuOne: "33000000-0000-4000-8000-000000000007",
  verdantMenuTwo: "33000000-0000-4000-8000-000000000008",
  verdantMenuThree: "33000000-0000-4000-8000-000000000009",
  saffronMenuOne: "33000000-0000-4000-8000-000000000010",
  saffronMenuTwo: "33000000-0000-4000-8000-000000000011",
  saffronMenuThree: "33000000-0000-4000-8000-000000000012",
  seoulMenuOne: "33000000-0000-4000-8000-000000000013",
  seoulMenuTwo: "33000000-0000-4000-8000-000000000014",
  seoulMenuThree: "33000000-0000-4000-8000-000000000015",
  order: "44000000-0000-4000-8000-000000000001",
  orderItem: "55000000-0000-4000-8000-000000000001",
  conversation: "66000000-0000-4000-8000-000000000001",
  message: "77000000-0000-4000-8000-000000000001"
} as const;

type SeedTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function seedDashboardFixtures(tx: SeedTransaction, referenceDate: string): Promise<void> {
  await tx.insert(users).values(dashboardCustomers).onConflictDoNothing({ target: users.id });
  const plans = buildDashboardOrderPlans(referenceDate);
  const seededCatererIds = [...demoCatererIds, ids.seoul];
  const [profiles, storedMenuItems, existingOrders] = await Promise.all([
    tx.select().from(caterers).where(inArray(caterers.id, seededCatererIds)).orderBy(caterers.id),
    tx.select().from(menuItems).where(inArray(menuItems.catererId, seededCatererIds))
      .orderBy(menuItems.id),
    tx.select({ id: orders.id }).from(orders)
      .where(inArray(orders.id, plans.map((plan) => plan.id)))
  ]);
  const existingOrderIds = new Set(existingOrders.map((order) => order.id));
  const calendar = new Map<string, typeof availability.$inferInsert>();
  for (const [index, profile] of profiles.entries()) {
    for (let day = 1; day <= 30; day += 1) {
      const date = offsetSeedDate(referenceDate, day);
      calendar.set(`${profile.id}:${date}`, {
        catererId: profile.id,
        date,
        available: profile.active && (day + index) % 7 !== 0,
        capacityOverride: profile.maximumCapacity - index * 3
      });
    }
  }
  for (const plan of plans) {
    const profile = profiles.find((entry) => entry.id === plan.catererId);
    if (!profile) throw new Error("A fictional dashboard caterer is missing.");
    calendar.set(`${profile.id}:${plan.eventDate}`, {
      catererId: profile.id,
      date: plan.eventDate,
      available: profile.active,
      capacityOverride: profile.maximumCapacity
    });
  }
  await tx.insert(availability).values([...calendar.values()])
    .onConflictDoNothing({ target: [availability.catererId, availability.date] });
  const storedAvailability = await tx.select().from(availability)
    .where(inArray(availability.catererId, seededCatererIds));

  for (const plan of plans) {
    if (existingOrderIds.has(plan.id)) continue;
    const profile = profiles.find((entry) => entry.id === plan.catererId);
    const selection = storedMenuItems
      .filter((item) => item.catererId === plan.catererId && item.active).slice(0, 2);
    const eventStyle = profile?.supportedEventStyles[0];
    if (!profile?.active || !eventStyle || selection.length === 0) {
      throw new Error("Fictional dashboard orders require an active caterer and menu.");
    }
    const dateAvailability = storedAvailability.find((entry) =>
      entry.catererId === plan.catererId && entry.date === plan.eventDate
    );
    if (!assessAvailability(profile, dateAvailability, plan.guestCount).available) {
      throw new Error("A fictional order requires availability and sufficient capacity.");
    }
    const selections = selection.map((item, index) => ({
      menuItemId: item.id,
      unitPrice: item.price,
      quantity: index === 0 ? plan.guestCount : Math.ceil(plan.guestCount / 2)
    }));
    const fulfillmentMethod = profile.fulfillmentMethod === "DELIVERY" ? "DELIVERY" : "PICKUP";
    const subtotal = calculateOrderTotal(selections);
    const minimum = Math.max(
      moneyToCents(profile.minimumOrder),
      fulfillmentMethod === "DELIVERY" && profile.minimumDeliveryOrder
        ? moneyToCents(profile.minimumDeliveryOrder) : 0
    );
    if (subtotal.cents < minimum) throw new Error("A fictional order is below the minimum order.");
    const totalCents = subtotal.cents + (
      fulfillmentMethod === "DELIVERY" && profile.deliveryFee ? moneyToCents(profile.deliveryFee) : 0
    );
    // These are fictional historical fixtures. Validate their simulated lifecycle.
    if (plan.status !== "DRAFT") assertOrderTransition("DRAFT", "REQUESTED");
    if (plan.status === "COMPLETED") {
      assertOrderTransition("REQUESTED", "ACCEPTED");
      assertOrderTransition("ACCEPTED", "COMPLETED");
    } else if (plan.status !== "DRAFT" && plan.status !== "REQUESTED") {
      assertOrderTransition("REQUESTED", plan.status);
    }
    const updatedAt = plan.status === "COMPLETED"
      ? new Date(`${plan.eventDate}T18:00:00.000Z`) : plan.createdAt;
    const [created] = await tx.insert(orders).values({
      id: plan.id,
      customerId: plan.customerId,
      catererId: plan.catererId,
      eventDate: plan.eventDate,
      guestCount: plan.guestCount,
      budget: centsToMoney(totalCents + 10_000),
      estimatedTotal: centsToMoney(totalCents),
      requestedDishes: selection.map((item) => item.name),
      requestedCuisines: profile.cuisineTypes,
      eventStyle,
      dietaryRestrictions: [],
      eventLocation: profile.location,
      fulfillmentMethod,
      status: plan.status,
      specialRequests: "Fictional demo order for dashboard development.",
      createdAt: plan.createdAt,
      updatedAt
    }).onConflictDoNothing({ target: orders.id }).returning({ id: orders.id });
    if (created) {
      await tx.insert(orderItems).values(selections.map((selection) => ({
        orderId: created.id,
        menuItemId: selection.menuItemId,
        quantity: selection.quantity,
        unitPrice: selection.unitPrice,
        createdAt: plan.createdAt
      }))).onConflictDoNothing({ target: [orderItems.orderId, orderItems.menuItemId] });
    }
  }

  const seededOrders = await tx.select().from(orders)
    .where(inArray(orders.id, [ids.order, ...plans.map((plan) => plan.id)]))
    .orderBy(orders.id);
  const customerIds = [ids.customer, ...dashboardCustomers.map((customer) => customer.id)];
  for (const [index, customerId] of customerIds.entries()) {
    const order = seededOrders.find((entry) => entry.customerId === customerId);
    if (!order) throw new Error("A fictional customer has no dashboard order.");
    const conversationId = seedId("66000000", index + 1);
    await tx.insert(conversations).values({
      id: conversationId,
      userId: customerId,
      externalConversationId: index === 0
        ? "test:conversation:river-stone" : `test:conversation:dashboard-${index}`
    }).onConflictDoNothing({ target: conversations.id });
    await tx.insert(messages).values([
      {
        id: seedId("77000000", index * 2 + 2),
        conversationId,
        sender: "CUSTOMER",
        content: `Fictional demo request: catering for ${order.guestCount} guests on ${order.eventDate}.`,
        externalMessageId: `test:dashboard-message:${index}:customer`
      },
      {
        id: seedId("77000000", index * 2 + 3),
        conversationId,
        sender: "SYSTEM",
        content: `Fictional demo order status: ${order.status}.`,
        externalMessageId: `test:dashboard-message:${index}:system`
      }
    ]).onConflictDoNothing({ target: messages.id });
    await tx.insert(cateringRequestStates).values({
      conversationId,
      customerId,
      eventDate: order.eventDate,
      budget: order.budget,
      dishes: order.requestedDishes,
      cuisines: order.requestedCuisines,
      headcount: order.guestCount,
      eventStyle: order.eventStyle,
      dietaryRestrictions: order.dietaryRestrictions,
      dietaryRestrictionsConfirmed: true,
      location: order.eventLocation,
      fulfillmentMethod: order.fulfillmentMethod,
      recentSearchResultIds: [order.catererId],
      selectedCatererId: order.catererId,
      pendingOrderId: order.id
    }).onConflictDoNothing({ target: cateringRequestStates.conversationId });
  }
}

async function seedDatabase(): Promise<void> {
  const referenceDate = new Date().toISOString().slice(0, 10);
  try {
    const added = await db.transaction(async (tx) => {
      await tx
        .insert(users)
        .values([
          {
            id: ids.jadeOwner,
            messagingIdentifier: "test:caterer:jade-juniper",
            name: "Avery Lin",
            role: "CATERER"
          },
          {
            id: ids.cactusOwner,
            messagingIdentifier: "test:caterer:copper-cactus",
            name: "Morgan Reyes",
            role: "CATERER"
          },
          {
            id: ids.verdantOwner,
            messagingIdentifier: "test:caterer:verdant-table",
            name: "Rowan Park",
            role: "CATERER"
          },
          {
            id: ids.saffronOwner,
            messagingIdentifier: "test:caterer:saffron-harbor",
            name: "Samira Vale",
            role: "CATERER"
          },
          {
            id: ids.seoulOwner,
            messagingIdentifier: "test:caterer:seoul-meadow",
            name: "Jun Kim",
            role: "CATERER"
          },
          {
            id: ids.customer,
            messagingIdentifier: "test:customer:river-stone",
            name: "River Stone",
            role: "CUSTOMER"
          }
        ])
        .onConflictDoNothing({ target: users.id });

      await tx
        .insert(caterers)
        .values([
          {
            id: ids.jade,
            ownerUserId: ids.jadeOwner,
            businessName: "Jade Juniper Kitchen",
            description:
              "Family-style Chinese catering with vegetable-forward banquet dishes.",
            cuisineTypes: ["CHINESE"],
            location: "Ann Arbor, MI",
            serviceAreas: ["Ann Arbor, MI", "Ypsilanti, MI"],
            serviceRadius: 20,
            minimumOrder: "150.00",
            maximumCapacity: 85,
            supportedEventStyles: ["BUFFET", "FAMILY_STYLE", "CASUAL"],
            fulfillmentMethod: "DELIVERY",
            deliveryRadius: 20,
            deliveryFee: "25.00",
            minimumDeliveryOrder: "150.00",
            active: true
          },
          {
            id: ids.cactus,
            ownerUserId: ids.cactusOwner,
            businessName: "Copper Cactus Taqueria",
            description: "Festive Mexican taco bars and fresh sides for casual gatherings.",
            cuisineTypes: ["MEXICAN"],
            location: "Ypsilanti, MI",
            serviceAreas: ["Ypsilanti, MI"],
            serviceRadius: 15,
            minimumOrder: "200.00",
            maximumCapacity: 140,
            supportedEventStyles: ["CASUAL", "DROP_OFF"],
            fulfillmentMethod: "EITHER",
            deliveryRadius: 15,
            deliveryFee: "20.00",
            minimumDeliveryOrder: "200.00",
            active: true
          },
          {
            id: ids.verdant,
            ownerUserId: ids.verdantOwner,
            businessName: "Verdant Table Collective",
            description: "Plant-based seasonal spreads made for smaller, thoughtful events.",
            cuisineTypes: ["VEGAN", "CONTEMPORARY"],
            location: "Ann Arbor, MI",
            serviceAreas: ["Ann Arbor, MI"],
            serviceRadius: 10,
            minimumOrder: "275.00",
            maximumCapacity: 45,
            supportedEventStyles: ["BUFFET", "FORMAL"],
            fulfillmentMethod: "PICKUP",
            deliveryRadius: null,
            deliveryFee: null,
            minimumDeliveryOrder: null,
            active: true
          },
          {
            id: ids.saffron,
            ownerUserId: ids.saffronOwner,
            businessName: "Saffron Harbor Mezze",
            description: "Mediterranean mezze platters, grills, and bright seasonal salads.",
            cuisineTypes: ["MEDITERRANEAN"],
            location: "Detroit, MI",
            serviceAreas: ["Detroit, MI"],
            serviceRadius: 25,
            minimumOrder: "300.00",
            maximumCapacity: 110,
            supportedEventStyles: ["FORMAL", "FAMILY_STYLE"],
            fulfillmentMethod: "DELIVERY",
            deliveryRadius: 25,
            deliveryFee: "40.00",
            minimumDeliveryOrder: "350.00",
            active: true
          },
          {
            id: ids.seoul,
            ownerUserId: ids.seoulOwner,
            businessName: "Seoul Meadow Supper Club",
            description: "Korean comfort food and tabletop barbecue for celebratory meals.",
            cuisineTypes: ["KOREAN"],
            location: "Ann Arbor, MI",
            serviceAreas: ["Ann Arbor, MI"],
            serviceRadius: 18,
            minimumOrder: "180.00",
            maximumCapacity: 60,
            supportedEventStyles: ["CASUAL", "INDIVIDUAL_MEALS"],
            fulfillmentMethod: "PICKUP",
            deliveryRadius: null,
            deliveryFee: null,
            minimumDeliveryOrder: null,
            active: false
          }
        ])
        .onConflictDoNothing({ target: caterers.id });

      await tx
        .insert(menuItems)
        .values([
          {
            id: ids.jadeMenuOne,
            catererId: ids.jade,
            name: "Vegetable Dumplings",
            description: "Hand-folded vegetable dumplings with ginger dipping sauce.",
            price: "11.50",
            dietaryTags: ["VEGETARIAN", "VEGAN"]
          },
          {
            id: ids.jadeMenuTwo,
            catererId: ids.jade,
            name: "Ginger Scallion Fried Rice",
            description: "Wok-tossed fried rice with ginger, scallions, and seasonal greens.",
            price: "10.00",
            dietaryTags: ["VEGETARIAN", "VEGAN", "GLUTEN_FREE"]
          },
          {
            id: ids.jadeMenuThree,
            catererId: ids.jade,
            name: "Five-Spice Chicken",
            description: "Roasted chicken with fragrant five-spice glaze.",
            price: "13.50",
            dietaryTags: []
          },
          {
            id: ids.cactusMenuOne,
            catererId: ids.cactus,
            name: "Citrus Chicken Tacos",
            description: "Corn tortillas with marinated chicken, citrus salsa, and onions.",
            price: "12.00",
            dietaryTags: ["GLUTEN_FREE"]
          },
          {
            id: ids.cactusMenuTwo,
            catererId: ids.cactus,
            name: "Charred Vegetable Tacos",
            description: "Seasonal vegetables, black beans, and avocado salsa.",
            price: "11.00",
            dietaryTags: ["VEGETARIAN", "VEGAN", "GLUTEN_FREE"]
          },
          {
            id: ids.cactusMenuThree,
            catererId: ids.cactus,
            name: "Cilantro Lime Rice",
            description: "Fluffy rice with lime, cilantro, and scallions.",
            price: "4.00",
            dietaryTags: ["VEGETARIAN", "VEGAN", "GLUTEN_FREE"]
          },
          {
            id: ids.verdantMenuOne,
            catererId: ids.verdant,
            name: "Roasted Cauliflower Shawarma",
            description: "Spiced cauliflower with tahini and herb salad.",
            price: "15.00",
            dietaryTags: ["VEGETARIAN", "VEGAN", "GLUTEN_FREE"]
          },
          {
            id: ids.verdantMenuTwo,
            catererId: ids.verdant,
            name: "Smoky Lentil Pilaf",
            description: "Herbed lentils, rice, and toasted seeds.",
            price: "12.50",
            dietaryTags: ["VEGETARIAN", "VEGAN", "GLUTEN_FREE"]
          },
          {
            id: ids.verdantMenuThree,
            catererId: ids.verdant,
            name: "Berry Oat Squares",
            description: "Oat crumble bars with seasonal berries.",
            price: "6.00",
            dietaryTags: ["VEGETARIAN", "VEGAN"]
          },
          {
            id: ids.saffronMenuOne,
            catererId: ids.saffron,
            name: "Herb Chicken Skewers",
            description: "Lemon-herb chicken with garlic yogurt sauce.",
            price: "16.00",
            dietaryTags: ["HALAL", "GLUTEN_FREE"]
          },
          {
            id: ids.saffronMenuTwo,
            catererId: ids.saffron,
            name: "Roasted Eggplant Mezze",
            description: "Roasted eggplant, tomato, parsley, and warm flatbread.",
            price: "11.00",
            dietaryTags: ["VEGETARIAN", "VEGAN"]
          },
          {
            id: ids.saffronMenuThree,
            catererId: ids.saffron,
            name: "Lemon Olive Couscous",
            description: "Couscous with olives, lemon, and fresh herbs.",
            price: "7.50",
            dietaryTags: ["VEGETARIAN", "VEGAN"]
          },
          {
            id: ids.seoulMenuOne,
            catererId: ids.seoul,
            name: "Bulgogi Rice Bowls",
            description: "Marinated beef, rice, and crisp seasonal vegetables.",
            price: "17.00",
            dietaryTags: []
          },
          {
            id: ids.seoulMenuTwo,
            catererId: ids.seoul,
            name: "Crispy Tofu Bibimbap",
            description: "Crispy tofu, vegetables, rice, and gochujang.",
            price: "14.00",
            dietaryTags: ["VEGETARIAN", "VEGAN"]
          },
          {
            id: ids.seoulMenuThree,
            catererId: ids.seoul,
            name: "Sesame Cucumber Salad",
            description: "Chilled cucumbers with sesame, garlic, and rice vinegar.",
            price: "5.50",
            dietaryTags: ["VEGETARIAN", "VEGAN", "GLUTEN_FREE"]
          }
        ])
        .onConflictDoNothing({ target: menuItems.id });

      await tx
        .insert(availability)
        .values([
          { catererId: ids.jade, date: "2030-06-15", available: true, capacityOverride: 70 },
          { catererId: ids.jade, date: "2030-06-22", available: true, capacityOverride: 85 },
          { catererId: ids.cactus, date: "2030-06-15", available: true, capacityOverride: 120 },
          { catererId: ids.cactus, date: "2030-06-22", available: false, capacityOverride: null },
          { catererId: ids.verdant, date: "2030-06-15", available: true, capacityOverride: 40 },
          { catererId: ids.verdant, date: "2030-06-22", available: true, capacityOverride: 45 },
          { catererId: ids.saffron, date: "2030-06-15", available: false, capacityOverride: null },
          { catererId: ids.saffron, date: "2030-06-22", available: true, capacityOverride: 100 },
          { catererId: ids.seoul, date: "2030-06-15", available: true, capacityOverride: 55 },
          { catererId: ids.seoul, date: "2030-06-22", available: true, capacityOverride: 60 }
        ])
        .onConflictDoNothing({ target: [availability.catererId, availability.date] });

      const [demoMenuItem] = await tx.select().from(menuItems)
        .where(and(eq(menuItems.id, ids.jadeMenuOne), eq(menuItems.catererId, ids.jade)));
      const [demoCaterer] = await tx.select().from(caterers).where(eq(caterers.id, ids.jade));
      if (!demoMenuItem || !demoCaterer) throw new Error("Fictional demo catalog is missing.");
      const demoSubtotal = calculateOrderTotal([{ quantity: 30, unitPrice: demoMenuItem.price }]);
      const demoTotalCents = demoSubtotal.cents + moneyToCents(demoCaterer.deliveryFee ?? "0.00");

      await tx
        .insert(orders)
        .values({
          id: ids.order,
          customerId: ids.customer,
          catererId: ids.jade,
          eventDate: "2030-06-15",
          guestCount: 30,
          budget: centsToMoney(Math.max(45_000, demoTotalCents)),
          estimatedTotal: centsToMoney(demoTotalCents),
          requestedDishes: ["dumplings"],
          requestedCuisines: ["Chinese"],
          eventStyle: "BUFFET",
          dietaryRestrictions: ["VEGETARIAN"],
          eventLocation: "Ann Arbor, MI",
          fulfillmentMethod: "DELIVERY",
          status: "REQUESTED",
          specialRequests: "Please include vegetarian serving labels."
        })
        .onConflictDoNothing({ target: orders.id });

      await tx
        .insert(orderItems)
        .values({
          id: ids.orderItem,
          orderId: ids.order,
          menuItemId: ids.jadeMenuOne,
          quantity: 30,
          unitPrice: demoMenuItem.price
        })
        .onConflictDoNothing({ target: orderItems.id });

      await tx
        .insert(conversations)
        .values({
          id: ids.conversation,
          userId: ids.customer,
          externalConversationId: "test:conversation:river-stone"
        })
        .onConflictDoNothing({ target: conversations.id });

      await tx
        .insert(messages)
        .values({
          id: ids.message,
          conversationId: ids.conversation,
          sender: "CUSTOMER",
          content: "I need Chinese catering for 30 guests.",
          externalMessageId: "test:message:river-stone:001"
        })
        .onConflictDoNothing({ target: messages.id });

      await seedDashboardFixtures(tx, referenceDate);
      return seedVarietyFixtures(tx, referenceDate);
    });

    console.info(`Fictional seed data completed; dashboard reference date: ${referenceDate}.`);
    console.info(`Added variety fixtures: ${JSON.stringify(added)}`);
  } finally {
    await closeDatabaseConnection();
  }
}

seedDatabase().catch(() => {
  console.error("Database seed failed. Check DATABASE_URL, migrations, and Neon connectivity.");
  process.exitCode = 1;
});
