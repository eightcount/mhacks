import { closeDatabaseConnection } from "./index.js";
import { getMarketplaceSummary } from "../services/reporting.js";

try {
  console.info(JSON.stringify(await getMarketplaceSummary(), null, 2));
} catch {
  console.error("Dashboard summary failed. Check local database access and connectivity.");
  process.exitCode = 1;
} finally {
  await closeDatabaseConnection();
}
