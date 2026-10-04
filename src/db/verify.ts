import { count } from "drizzle-orm";
import { closeDatabaseConnection, db } from "./index.js";
import {
  availability, catererAgentSessions, catererNotificationDrafts, catererOrderForms,
  catererPreorders, catererProductSpecs, cateringRequestStates, caterers, conversations,
  menuItems, messages, orderItems, orders, users
} from "./schema/index.js";

async function verifyDatabase(): Promise<void> {
  try {
    const tables = {
      users, caterers, menuItems, availability, orders, orderItems,
      conversations, messages, cateringRequestStates,
      catererProductSpecs, catererOrderForms, catererPreorders,
      catererNotificationDrafts, catererAgentSessions
    };
    const counts = await Promise.all(Object.entries(tables).map(async ([name, table]) => {
      const [row] = await db.select({ count: count() }).from(table);
      return [name, row!.count] as const;
    }));
    console.info("Database verification passed:");
    console.info(JSON.stringify(Object.fromEntries(counts), null, 2));
  } finally {
    await closeDatabaseConnection();
  }
}

verifyDatabase().catch(() => {
  console.error("Database verification failed. Check DATABASE_URL, migrations, and Neon connectivity.");
  process.exitCode = 1;
});
