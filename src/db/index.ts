import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set before using the database.");
}

/**
 * Opens one Drizzle/Postgres.js connection. The normal application connection
 * uses DATABASE_URL, which may be a Neon pooled URL. Migrations create a
 * separate connection with DATABASE_URL_UNPOOLED when it is available.
 */
export function createDatabaseConnection(connectionString: string) {
  // `prepare: false` is recommended for Neon and other PgBouncer-compatible pools.
  const databaseClient = postgres(connectionString, { prepare: false });
  const database = drizzle(databaseClient, { schema });

  return {
    client: databaseClient,
    db: database,
    async close(): Promise<void> {
      await databaseClient.end({ timeout: 5 });
    }
  };
}

const defaultConnection = createDatabaseConnection(databaseUrl);

export const client = defaultConnection.client;
export const db = defaultConnection.db;

export async function closeDatabaseConnection(): Promise<void> {
  await defaultConnection.close();
}
