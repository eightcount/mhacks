import "dotenv/config";
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { Spectrum } from "@spectrum-ts/core";
import { imessage, iMessageSpaceSchema } from "./photon-sdk.js";
import { getPhotonConfig } from "./photon-config.js";
import { callCatererAgent, callCatererTool } from "./caterer-client.js";
import { routePhotonMessage } from "./photon-router.js";
import { dispatchPhotonNotification } from "./photon-notifications.js";

async function main() {
  const config = getPhotonConfig();
  const startedAt = Date.now();
  // Owner configuration is checked before any connection to the messaging provider.
  await callCatererTool("menu", {});
  const app = await Spectrum({projectId: config.projectId, projectSecret: config.projectSecret,
    providers: [imessage.config()], telemetry: false, options: {logLevel: "silent"}});
  const server = createServer(async (request, response) => {
    const json = (status: number, body: unknown) => {response.writeHead(status, {"Content-Type": "application/json"}); response.end(JSON.stringify(body));};
    if (request.url === "/health" && request.method === "GET") return json(200, {status: "connected"});
    const expected = Buffer.from(`Bearer ${config.token}`), received = Buffer.from(request.headers.authorization || "");
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return json(401, {error: "Unauthorized"});
    if (request.url !== "/notifications/send" || request.method !== "POST") return json(404, {error: "Not found"});
    try {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 64000) throw new Error("Request too large");
        chunks.push(Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks).toString("utf8");
      const result = await dispatchPhotonNotification(JSON.parse(body), request.headers['idempotency-key'], {
        projectId: config.projectId, tool: callCatererTool,
        send: async (recipient, text) => {
          const chat = await imessage(app).space.create(recipient, config.line ? {phone: config.line} : undefined);
          const sent = await chat.send(text);
          if (!sent?.id) throw new Error("No send receipt");
          return sent.id;
        }
      });
      return json(200, result);
    } catch {return json(502, {error: "Photon did not confirm submission. Check the provider before retrying."});}
  });
  try {
    await new Promise<void>((resolve, reject) => {server.once("error", reject); server.listen(config.photonPort, "127.0.0.1", resolve);});
  } catch (error) {await app.stop(); throw error;}
  console.info("[photon] Connected. Waiting for new direct messages from the configured owner.");
  let stopping = false;
  const stop = async () => {if (stopping) return; stopping = true; server.close(); await app.stop();};
  process.once("SIGINT", () => {void stop();}); process.once("SIGTERM", () => {void stop();});
  try {
    for await (const [space, message] of app.messages) {
      // Serial handling preserves conversational turn order. Normalization lives
      // in the transport; marketplace logic remains behind the agent's tools.
      if (message.content.type !== "text" || message.sender?.kind === "agent") continue;
      const details = iMessageSpaceSchema.safeParse(space);
      if (!details.success || (config.line && details.data.phone !== config.line)) continue;
      try {
        const result = await routePhotonMessage({id: message.id, chatId: space.id, sender: message.sender?.id || "",
          text: message.content.text, direction: message.direction, platform: message.platform,
          chatType: details.data.type, line: details.data.phone, timestamp: message.timestamp}, {
          projectId: config.projectId, owner: config.owner, startedAt,
          tool: callCatererTool, agent: callCatererAgent,
          send: async (chatId, text) => {
            if (chatId !== space.id) throw new Error("Reply conversation mismatch");
            const sent = await space.send(text);
            if (!sent?.id) throw new Error("No send receipt");
          }
        });
        if (result === "SENT") console.info("[photon] Owner message handled.");
        if (result === "FAILED") console.error("[photon] Reply submission unconfirmed. Check the provider before retrying.");
      } catch {console.error("[photon] Message processing failed. Details withheld to protect private data.");}
    }
  } finally {await stop();}
}
main().catch(() => {console.error("[photon] Could not connect. Run npm run photon:check and verify the iMessage line is enabled in Photon."); process.exitCode = 1;});
