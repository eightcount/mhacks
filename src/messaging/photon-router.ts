import { z } from "zod";
import { normalizeIMessageHandle, photonDigest } from "./photon-config.js";
import { agentReplySchema, type AgentReply } from "../validation/photon.js";

export interface PhotonInbound {
  id: string; chatId: string; line: string; sender: string; text: string; direction: string;
  platform: string; chatType: string; timestamp: Date;
}
const receipt = z.object({claimed: z.boolean(), status: z.string(), reply: agentReplySchema.optional(), documentUrl: z.string().optional()});
export interface PhotonRouterDependencies {
  projectId: string; owner: string; startedAt: number;
  tool: (name: string, input: unknown) => Promise<unknown>;
  agent: (sessionId: string, text: string) => Promise<AgentReply>;
  send: (chatId: string, text: string) => Promise<void>;
}
export async function routePhotonMessage(message: PhotonInbound, deps: PhotonRouterDependencies) {
  // A relay's identity must never grant its other users access to the business.
  if (message.platform !== "imessage" || message.direction !== "inbound" || message.chatType !== "dm" ||
      normalizeIMessageHandle(message.sender) !== deps.owner || !message.id || !message.chatId ||
      !Number.isFinite(message.timestamp.getTime()) || message.timestamp.getTime() < deps.startedAt ||
      !message.text.trim()) return "IGNORED";
  const key = photonDigest(deps.projectId, message.line, message.chatId, message.id);
  const sessionId = `photon-chat:${photonDigest(deps.projectId, message.line, message.chatId, deps.owner)}`;
  let state = receipt.parse(await deps.tool("photon_receipt", {key, action: "claim"}));
  if (state.claimed) {
    let reply: AgentReply;
    if (message.text.length > 8000) reply = {text: "Please send a shorter message (up to 8,000 characters)."};
    else {
      try { reply = await deps.agent(sessionId, message.text); }
      catch {reply = {text: "I couldn't finish that request. Ask for orders or forms to check whether it was saved before trying again."};}
    }
    state = receipt.parse(await deps.tool("photon_receipt", {key, action: "ready", reply}));
  }
  if (state.status !== "READY") return "DUPLICATE";
  state = receipt.parse(await deps.tool("photon_receipt", {key, action: "dispatch"}));
  if (!state.claimed || !state.reply) return "DUPLICATE";
  try {
    let replyText = state.reply.text;
    if (state.reply.html) {
      const title = state.reply.documentKind === "grocery_demo" ? "View your demo grocery basket" : "Print your labels";
      replyText += state.documentUrl ? `\n${title}: ${state.documentUrl}\nThis private link expires in one hour.`
        : "\nUse the local caterer CLI to save this document until a public form URL is configured.";
    }
    const characters = [...replyText];
    for (let index = 0; index < characters.length; index += 4000) await deps.send(message.chatId, characters.slice(index, index + 4000).join(""));
    await deps.tool("photon_receipt", {key, action: "sent"});
    return "SENT";
  } catch {
    await deps.tool("photon_receipt", {key, action: "failed"});
    return "FAILED";
  }
}
