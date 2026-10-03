import { sql } from "drizzle-orm";
import { closeDatabaseConnection, db } from "./index.js";
import {
  availability,
  caterers,
  conversations,
  menuItems,
  messages,
  orderItems,
  orders,
  users
} from "./schema/index.js";

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

async function seedDatabase(): Promise<void> {
  try {
    await db.transaction(async (tx) => {
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
        .onConflictDoUpdate({
          target: caterers.id,
          set: {
            ownerUserId: sql`excluded.owner_user_id`,
            businessName: sql`excluded.business_name`,
            description: sql`excluded.description`,
            cuisineTypes: sql`excluded.cuisine_types`,
            location: sql`excluded.location`,
            serviceAreas: sql`excluded.service_areas`,
            serviceRadius: sql`excluded.service_radius`,
            minimumOrder: sql`excluded.minimum_order`,
            maximumCapacity: sql`excluded.maximum_capacity`,
            supportedEventStyles: sql`excluded.supported_event_styles`,
            fulfillmentMethod: sql`excluded.fulfillment_method`,
            deliveryRadius: sql`excluded.delivery_radius`,
            deliveryFee: sql`excluded.delivery_fee`,
            minimumDeliveryOrder: sql`excluded.minimum_delivery_order`,
            active: sql`excluded.active`,
            updatedAt: new Date()
          }
        });

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
        .onConflictDoUpdate({
          target: menuItems.id,
          set: {
            catererId: sql`excluded.caterer_id`,
            name: sql`excluded.name`,
            description: sql`excluded.description`,
            price: sql`excluded.price`,
            dietaryTags: sql`excluded.dietary_tags`,
            active: sql`excluded.active`,
            updatedAt: new Date()
          }
        });

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
        .onConflictDoUpdate({
          target: [availability.catererId, availability.date],
          set: {
            available: sql`excluded.available`,
            capacityOverride: sql`excluded.capacity_override`,
            updatedAt: new Date()
          }
        });

      await tx
        .insert(orders)
        .values({
          id: ids.order,
          customerId: ids.customer,
          catererId: ids.jade,
          eventDate: "2030-06-15",
          guestCount: 30,
          budget: "450.00",
          estimatedTotal: "370.00",
          requestedDishes: ["dumplings"],
          requestedCuisines: ["Chinese"],
          eventStyle: "BUFFET",
          dietaryRestrictions: ["VEGETARIAN"],
          eventLocation: "Ann Arbor, MI",
          fulfillmentMethod: "DELIVERY",
          status: "REQUESTED",
          specialRequests: "Please include vegetarian serving labels."
        })
        .onConflictDoUpdate({
          target: orders.id,
          set: {
            customerId: sql`excluded.customer_id`,
            catererId: sql`excluded.caterer_id`,
            eventDate: sql`excluded.event_date`,
            guestCount: sql`excluded.guest_count`,
            budget: sql`excluded.budget`,
            estimatedTotal: sql`excluded.estimated_total`,
            requestedDishes: sql`excluded.requested_dishes`,
            requestedCuisines: sql`excluded.requested_cuisines`,
            eventStyle: sql`excluded.event_style`,
            dietaryRestrictions: sql`excluded.dietary_restrictions`,
            eventLocation: sql`excluded.event_location`,
            fulfillmentMethod: sql`excluded.fulfillment_method`,
            status: sql`excluded.status`,
            specialRequests: sql`excluded.special_requests`,
            updatedAt: new Date()
          }
        });

      await tx
        .insert(orderItems)
        .values({
          id: ids.orderItem,
          orderId: ids.order,
          menuItemId: ids.jadeMenuOne,
          quantity: 30,
          unitPrice: "11.50"
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
    });

    console.info("Fictional seed data completed.");
  } finally {
    await closeDatabaseConnection();
  }
}

seedDatabase().catch(() => {
  console.error("Database seed failed. Check DATABASE_URL, migrations, and Neon connectivity.");
  process.exitCode = 1;
});
