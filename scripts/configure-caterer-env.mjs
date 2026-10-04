import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { parse } from "dotenv";

let text;
try { text = await readFile(".env", "utf8"); } catch (error) { if(error.code !== "ENOENT") throw error; text = ""; }
const existing = parse(text);
const defaults = {CATERER_INTERNAL_TOKEN: randomBytes(32).toString("base64url"), FETCH_CATERER_SEED: randomBytes(48).toString("base64url"),
  CATERER_ID: "22000000-0000-4000-8000-000000000001", CATERER_OWNER_USER_ID: "11000000-0000-4000-8000-000000000001",
  CATERER_BACKEND_PORT: "4002", FETCH_CATERER_PORT: "8002", CATERER_PUBLIC_BASE_URL: "http://127.0.0.1:4002"};
for (const [key,value] of Object.entries(defaults)) if (!existing[key]) {
  const pattern = new RegExp(`^${key}=.*$`, "m");
  text = pattern.test(text) ? text.replace(pattern, `${key}=${value}`) : `${text}${text.endsWith("\n")?"":"\n"}${key}=${value}\n`;
}
await writeFile(".env", text, {mode: 0o600});
console.info("Caterer environment configured for the fictional demo owner. Existing credentials and agent identities were preserved.");
