import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set before using the database.");
}

// `prepare: false` is recommended for Neon and other PgBouncer-compatible pools.
export const client = postgres(databaseUrl, { prepare: false });
export const db = drizzle(client, { schema });

export async function closeDatabaseConnection(): Promise<void> {
  await client.end({ timeout: 5 });
}
