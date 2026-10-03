import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDatabaseConnection, db } from "./index.js";

async function runMigrations(): Promise<void> {
  try {
    await migrate(db, { migrationsFolder: "drizzle" });
    console.info("Database migrations completed.");
  } finally {
    await closeDatabaseConnection();
  }
}

runMigrations().catch((error: unknown) => {
  console.error("Database migration failed.");
  console.error(error);
  process.exitCode = 1;
});
