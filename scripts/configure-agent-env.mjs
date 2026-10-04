import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const environmentPath = resolve(".env");
const demoCustomerId = "11000000-0000-4000-8000-000000000006";

let environment = "";
try {
  environment = await readFile(environmentPath, "utf8");
} catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
    throw error;
  }
}

function setIfBlank(key, value) {
  const pattern = new RegExp(`^(${key}=).*$`, "m");
  const match = environment.match(pattern);
  if (match?.[0] && match[0].slice(key.length + 1).trim().length > 0) {
    return;
  }
  if (match) {
    environment = environment.replace(pattern, `${key}=${value}`);
    return;
  }
  environment = `${environment}${environment.endsWith("\n") || environment.length === 0 ? "" : "\n"}${key}=${value}\n`;
}

setIfBlank("AGENT_INTERNAL_TOKEN", randomBytes(32).toString("base64url"));
setIfBlank("FETCH_AGENT_SEED", randomBytes(48).toString("base64url"));
setIfBlank("FETCH_AGENT_DEFAULT_CUSTOMER_ID", demoCustomerId);
setIfBlank("FETCH_AGENT_MAILBOX", "true");
setIfBlank("FETCH_AGENT_LOG_LEVEL", "INFO");

await writeFile(environmentPath, environment);
console.info("Agent environment initialized. Set DATABASE_URL manually before starting the local agent.");
