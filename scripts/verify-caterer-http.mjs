import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
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
let stage = "backend-startup";
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
  stage = "authentication";
  assert.equal((await fetch(`${base}/tools/menu`, {method: "POST"})).status, 401);
  const tool = async (name, body) => {
    const response = await fetch(`${base}/tools/${name}`, {method: "POST", headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json"}, body: JSON.stringify(body)});
    const result = await response.json();
    assert.equal(response.status, 200, `Tool ${name} failed: ${result.error ?? 'unexpected status'}`);
    return result;
  };
  const session = `photon-chat:${randomBytes(32).toString("hex")}`;
  const conversation = (phase, formId = "") => new Promise((resolve, reject) => {
    const python = spawn(existsSync(".venv/bin/python") ? ".venv/bin/python" : "python3",
      ["-m", "fetch_agent.verify_caterer_conversation", phase], {
        env: {...process.env, CATERER_INTERNAL_TOKEN: token, CATERER_BACKEND_PORT: String(port),
          CATERER_VERIFY_SESSION: session, CATERER_VERIFY_FORM: formId, CATERER_CONVERSATION_VERIFY: "isolated-http-harness"},
        stdio: ["ignore", "pipe", "pipe"]
      });
    let output = "";
    python.stdout.on("data", chunk => {output += String(chunk);});
    python.stderr.on("data", chunk => {
      // The verifier emits only fixed stage names, never backend response text.
      const safe = /Conversation verification failed at ([a-z-]+)\./.exec(String(chunk));
      if (safe) stage = `conversation-${safe[1]}`;
    });
    const timeout = setTimeout(() => {python.kill("SIGTERM"); reject(new Error("Conversation verification timed out"));}, 120000);
    python.once("error", () => {clearTimeout(timeout); reject(new Error("Python could not start"));});
    python.once("exit", code => {
      clearTimeout(timeout);
      if (code !== 0) return reject(new Error(`Conversation ${phase} verification failed`));
      try {resolve(JSON.parse(output));} catch {reject(new Error("Invalid verification result"));}
    });
  });
  stage = "form-conversation";
  const {formId, productSpecId} = await conversation("create");
  const form = {id: formId};
  stage = "public-form";
  const page = await fetch(`${base}/forms/${form.id}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert(html.includes("Fictional &lt;browser&gt; verification"));
  assert(html.includes("Minimum food order: $0.00"));
  assert(html.includes("per package"));
  const submissionId = /name="submissionId" value="([^"]+)"/.exec(html)?.[1];
  assert(submissionId);
  const post = async body => fetch(`${base}/forms/${form.id}`, {method: "POST", headers: {"Content-Type": "application/x-www-form-urlencoded"}, body: new URLSearchParams(body)});
  const fields = {submissionId, customerName: "Fictional Browser Customer", customerContact: "browser@example.invalid", deliveryAddress: "Fictional test street", [`item:${productSpecId}`]: "2"};
  stage = "submission";
  const receipt = await post(fields);
  assert.equal(receipt.status, 200); assert((await receipt.text()).includes("REQUESTED"));
  assert.equal((await post(fields)).status, 200);
  const soldOut = await post({...fields, submissionId: randomUUID()});
  assert.equal(soldOut.status, 400); assert((await soldOut.text()).includes("enough packages"));
  const {orders} = await tool("orders", {start: "2099-07-11", end: "2099-07-11"});
  assert(orders.some(order => order.formId === form.id));
  stage = "order-lookup";
  assert.equal((await conversation("lookup", form.id)).verified, true);
  console.info("PASS: authenticated conversation, restart-safe draft, natural dates, reviewed publication, public form submission, idempotency, capacity and natural order lookup on isolated Neon.");
} catch (error) {
  console.error("HTTP verification failed:", stage, error.name); // Never expose response bodies or database details.
  process.exitCode = 1;
} finally {server.kill("SIGTERM");}
