import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  appendAgentMessage,
  createAgentSession,
  getRequestState,
  updateRequestState
} from "../services/request-state.js";
import { DomainError } from "../services/errors.js";
import {
  checkAvailabilityTool,
  createOrderTool,
  getCatererTool,
  getMenuTool,
  getOrderTool,
  requestOrderTool,
  searchCaterersTool
} from "../tools/marketplace-tools.js";
import {
  appendAgentMessageSchema,
  createAgentSessionSchema,
  requestStateAddressSchema,
  updateRequestStateRequestSchema
} from "../validation/index.js";

const port = Number(process.env.AGENT_BACKEND_PORT || "4001");
const host = process.env.AGENT_BACKEND_HOST || "127.0.0.1";
const accessToken = process.env.AGENT_INTERNAL_TOKEN;

if (!accessToken) {
  throw new Error("AGENT_INTERNAL_TOKEN must be set before starting the internal agent API.");
}

type ToolHandler = (input: unknown) => Promise<unknown>;

const tools: Record<string, ToolHandler> = {
  search_caterers: searchCaterersTool,
  get_caterer: getCatererTool,
  get_menu: getMenuTool,
  check_availability: checkAvailabilityTool,
  create_order: createOrderTool,
  request_order: requestOrderTool,
  get_order: getOrderTool
};

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of request) {
    body += chunk.toString();
    if (body.length > 1_000_000) {
      throw new Error("Request body exceeds the 1 MB internal API limit.");
    }
  }
  return body.length === 0 ? {} : JSON.parse(body) as unknown;
}

function isAuthorized(request: IncomingMessage): boolean {
  return request.headers.authorization === `Bearer ${accessToken}`;
}

function errorResponse(error: unknown): { status: number; body: object } {
  if (error instanceof DomainError) {
    return { status: 400, body: { error: { code: error.code } } };
  }
  if (error instanceof SyntaxError) {
    return { status: 400, body: { error: { code: "INVALID_JSON" } } };
  }
  return { status: 400, body: { error: { code: "INVALID_INPUT" } } };
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    writeJson(response, 200, { status: "ok" });
    return;
  }
  if (!isAuthorized(request)) {
    writeJson(response, 401, { error: { code: "UNAUTHORIZED_AGENT" } });
    return;
  }
  if (request.method !== "POST") {
    writeJson(response, 405, { error: { code: "METHOD_NOT_ALLOWED" } });
    return;
  }

  try {
    const body = await readJson(request);
    const pathname = new URL(request.url ?? "/", `http://${host}:${port}`).pathname;

    if (pathname === "/v1/agent/session") {
      const state = await createAgentSession(createAgentSessionSchema.parse(body));
      writeJson(response, 200, { state });
      return;
    }
    if (pathname === "/v1/agent/request-state/get") {
      const address = requestStateAddressSchema.parse(body);
      const state = await getRequestState(address.conversationId, address.customerId);
      writeJson(response, 200, { state });
      return;
    }
    if (pathname === "/v1/agent/request-state/update") {
      const input = updateRequestStateRequestSchema.parse(body);
      const state = await updateRequestState(input.conversationId, input.customerId, input.patch);
      writeJson(response, 200, { state });
      return;
    }
    if (pathname === "/v1/agent/messages") {
      const message = await appendAgentMessage(appendAgentMessageSchema.parse(body));
      writeJson(response, 200, { message });
      return;
    }

    const toolName = pathname.replace("/v1/agent/tools/", "");
    const tool = tools[toolName];
    if (!tool || !pathname.startsWith("/v1/agent/tools/")) {
      writeJson(response, 404, { error: { code: "AGENT_ROUTE_NOT_FOUND" } });
      return;
    }
    console.info(`[agent-api] tool=${toolName}`);
    writeJson(response, 200, await tool(body));
  } catch (error: unknown) {
    const responseData = errorResponse(error);
    writeJson(response, responseData.status, responseData.body);
  }
});

server.listen(port, host, () => {
  console.info(`[agent-api] listening on http://${host}:${port}`);
});
