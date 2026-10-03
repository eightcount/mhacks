import { eq } from "drizzle-orm";
import { closeDatabaseConnection, db } from "./index.js";
import { availability, caterers, menuItems, orders } from "./schema/index.js";

async function verifyDatabase(): Promise<void> {
  try {
    const catererRows = await db
      .select({ id: caterers.id, businessName: caterers.businessName })
      .from(caterers)
      .limit(10);
    const firstCaterer = catererRows[0];

    const menuRows = firstCaterer
      ? await db
          .select({ id: menuItems.id, name: menuItems.name })
          .from(menuItems)
          .where(eq(menuItems.catererId, firstCaterer.id))
      : [];
    const availabilityRows = firstCaterer
      ? await db
          .select({ id: availability.id, date: availability.date })
          .from(availability)
          .where(eq(availability.catererId, firstCaterer.id))
      : [];
    const orderRows = await db
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .limit(10);

    console.info(
      `Database verification passed: ${catererRows.length} caterer(s), ${menuRows.length} menu item(s), ${availabilityRows.length} availability entry/entries, ${orderRows.length} order(s) retrieved.`
    );
  } finally {
    await closeDatabaseConnection();
  }
}

verifyDatabase().catch(() => {
  console.error("Database verification failed. Check DATABASE_URL, migrations, and Neon connectivity.");
  process.exitCode = 1;
});
