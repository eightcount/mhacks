import "dotenv/config";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabaseConnection } from "./index.js";

async function runMigrations(): Promise<void> {
  const migrationDatabaseUrl =
    process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

  if (!migrationDatabaseUrl) {
    throw new Error(
      "DATABASE_URL_UNPOOLED or DATABASE_URL must be set before running migrations."
    );
  }

  const connection = createDatabaseConnection(migrationDatabaseUrl);

  try {
    await migrate(connection.db, { migrationsFolder: "drizzle" });
    console.info("Database migrations completed.");
  } finally {
    await connection.close();
  }
}

runMigrations().catch((error: unknown) => {
  console.error("Database migration failed.");
  console.error(error);
  process.exitCode = 1;
});
