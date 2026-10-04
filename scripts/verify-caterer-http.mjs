import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { parse } from "dotenv";

const testEnv = parse(readFileSync(".env.caterer-test"));
const shared = parse(readFileSync(".env"));
assert(testEnv.DATABASE_URL);
assert.notEqual(new URL(testEnv.DATABASE_URL).hostname, new URL(shared.DATABASE_URL).hostname);
const token = randomBytes(32).toString("hex");
const server = spawn("node", ["--import", "tsx", "src/agent/caterer-api.ts"], {
  env: {...process.env, ...testEnv, CATERER_INTERNAL_TOKEN: token, CATERER_BACKEND_PORT: "0", CATERER_BACKEND_HOST: "127.0.0.1",
    CATERER_ID: "22000000-0000-4000-8000-000000000001", CATERER_OWNER_USER_ID: "11000000-0000-4000-8000-000000000001"},
  stdio: ["ignore", "pipe", "pipe"]
});
server.stderr.resume(); // Do not expose database connection failures or records.
try {
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Backend startup timed out")), 15000);
    server.once("exit", () => {clearTimeout(timeout); reject(new Error("Backend exited before startup"));});
    server.stdout.on("data", chunk => {
      const match = /listening on port (\d+)/.exec(String(chunk));
      if (match) {clearTimeout(timeout); resolve(match[1]);}
    });
  });
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${base}/tools/menu`, {method: "POST"})).status, 401);
  const tool = async (name, body) => {
    const response = await fetch(`${base}/tools/${name}`, {method: "POST", headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json"}, body: JSON.stringify(body)});
    const result = await response.json();
    assert.equal(response.status, 200, `Tool ${name} failed: ${result.error ?? 'unexpected status'}`);
    return result;
  };
  const {products} = await tool("recipes", {});
  assert(products[0]);
  const {form} = await tool("create_form", {title: "Fictional <browser> verification", fulfillmentDate: "2099-07-15",
    closesAt: "2099-07-10T18:00:00-04:00", fulfillmentMethod: "DELIVERY", fulfillmentInstructions: "Fictional demo delivery",
    minimumOrder: "0.00", products: [{productSpecId: products[0].id, maxPackages: 2}]});
  const page = await fetch(`${base}/forms/${form.id}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert(html.includes("Fictional &lt;browser&gt; verification"));
  assert(html.includes("Minimum food order: $0.00"));
  assert(html.includes("per package"));
  const submissionId = /name="submissionId" value="([^"]+)"/.exec(html)?.[1];
  assert(submissionId);
  const post = async body => fetch(`${base}/forms/${form.id}`, {method: "POST", headers: {"Content-Type": "application/x-www-form-urlencoded"}, body: new URLSearchParams(body)});
  const fields = {submissionId, customerName: "Fictional Browser Customer", customerContact: "browser@example.invalid", deliveryAddress: "Fictional test street", [`item:${products[0].id}`]: "2"};
  const receipt = await post(fields);
  assert.equal(receipt.status, 200); assert((await receipt.text()).includes("REQUESTED"));
  assert.equal((await post(fields)).status, 200);
  const soldOut = await post({...fields, submissionId: randomUUID()});
  assert.equal(soldOut.status, 400); assert((await soldOut.text()).includes("enough packages"));
  const {orders} = await tool("orders", {start: "2099-07-15", end: "2099-07-15"});
  assert(orders.some(order => order.formId === form.id));
  console.info("PASS: authenticated tools, public HTML form, escaped content, submission, repeat submission, sold-out validation, and owner order retrieval.");
} catch (error) {
  console.error("HTTP verification failed:", error.name, error.message);
  process.exitCode = 1;
} finally {server.kill("SIGTERM");}
