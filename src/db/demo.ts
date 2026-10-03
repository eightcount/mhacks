import { closeDatabaseConnection } from "./index.js";
import {
  acceptOrder,
  createOrder,
  getMenu,
  requestOrder,
  searchCaterers
} from "../services/index.js";

const customerId = "11000000-0000-4000-8000-000000000006";

async function runMarketplaceDemo(): Promise<void> {
  try {
    const request = {
      eventDate: "2030-06-15",
      budget: 450,
      cuisines: ["Chinese"],
      dishes: ["dumplings"],
      headcount: 30,
      eventStyle: "BUFFET" as const,
      dietaryRestrictions: ["VEGETARIAN" as const],
      location: "Ann Arbor, MI",
      fulfillmentMethod: "DELIVERY" as const
    };
    const matches = await searchCaterers(request);
    console.info(JSON.stringify({ customerRequest: request, matches }, null, 2));

    const selected = matches[0];
    if (!selected) {
      throw new Error("The fictional demo request did not return a matching caterer.");
    }

    const menu = await getMenu(selected.caterer.id, {
      dietaryRestrictions: ["VEGETARIAN"],
      requestedDishes: ["dumplings"]
    });
    const dumplings = menu[0];
    if (!dumplings) {
      throw new Error("The matching caterer has no selected fictional menu item.");
    }
    console.info(JSON.stringify({ selectedCaterer: selected.caterer.id, menu }, null, 2));

    const draft = await createOrder({
      customerId,
      catererId: selected.caterer.id,
      ...request,
      menuItems: [{ menuItemId: dumplings.id, quantity: 30 }],
      specialRequests: "Please label vegetarian servings."
    });
    const requested = await requestOrder(draft.order.id, customerId);
    const accepted = await acceptOrder(requested.id, selected.caterer.id);

    console.info(
      JSON.stringify(
        {
          orderId: accepted.id,
          draftStatus: draft.order.status,
          requestedStatus: requested.status,
          acceptedStatus: accepted.status,
          estimatedTotal: accepted.estimatedTotal
        },
        null,
        2
      )
    );
  } finally {
    await closeDatabaseConnection();
  }
}

runMarketplaceDemo().catch(() => {
  console.error("Marketplace demo failed. Check DATABASE_URL, migrations, and seed data.");
  process.exitCode = 1;
});
