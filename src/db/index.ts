import "dotenv/config";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set before using the database.");
}

/**
 * Opens a Postgres.js connection for migrations or the explicitly selected TCP
 * application driver. Migrations use DATABASE_URL_UNPOOLED when available.
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

function createApplicationConnection(connectionString: string) {
  let isNeon: boolean;
  try {
    isNeon = new URL(connectionString).hostname.endsWith(".neon.tech");
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
  const driver = process.env.DATABASE_DRIVER || (isNeon ? "neon" : "postgres");
  if (driver === "postgres") return createDatabaseConnection(connectionString);
  if (driver !== "neon") {
    throw new Error("DATABASE_DRIVER must be neon or postgres.");
  }
  if (typeof globalThis.WebSocket !== "function") {
    throw new Error("Neon connections require Node.js 22 or later.");
  }
  neonConfig.webSocketConstructor = globalThis.WebSocket;
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 15_000 });
  pool.on("error", () => {
    console.error("Neon connection failed. Check local database access and connectivity.");
  });
  return {
    client: pool,
    db: drizzleNeon(pool, { schema }),
    async close(): Promise<void> {
      await pool.end();
    }
  };
}

const defaultConnection = createApplicationConnection(databaseUrl);

export const client = defaultConnection.client;
export const db: PgDatabase<PgQueryResultHKT, typeof schema> = defaultConnection.db;

export async function closeDatabaseConnection(): Promise<void> {
  await defaultConnection.close();
}
