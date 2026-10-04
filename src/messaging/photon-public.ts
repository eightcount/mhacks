import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
export function isPublicCatererRoute(method: string, path: string) {
  return ((method === "GET" || method === "POST") && new RegExp(`^/forms/${uuid}$`).test(path)) ||
    (method === "GET" && /^\/documents\/[a-f0-9]{64}$/.test(path));
}

/** A public form gateway deliberately has no owner token or agent route. */
export async function forwardPublicCatererRequest(request: IncomingMessage, response: ServerResponse, backendPort: number) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  try {
    const url = new URL(request.url || "/", "http://localhost");
    if (!isPublicCatererRoute(request.method || "", url.pathname)) {
      response.writeHead(404); response.end("Not found"); return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > 64000) {response.writeHead(413); response.end("Request too large"); return;}
      chunks.push(Buffer.from(chunk));
    }
    const contentType = request.headers["content-type"] || "application/x-www-form-urlencoded";
    if (request.method === "POST" && !contentType.startsWith("application/x-www-form-urlencoded")) {
      response.writeHead(415); response.end("Use the order form to submit a request"); return;
    }
    const upstream = await fetch(`http://127.0.0.1:${backendPort}${url.pathname}${url.search}`, {
      method: request.method || "GET", headers: {"Content-Type": contentType},
      ...(request.method === "POST" ? {body: Buffer.concat(chunks)} : {}),
      signal: AbortSignal.timeout(30000), redirect: "error"
    });
    for (const header of ["content-type", "content-security-policy", "x-content-type-options"]) {
      const value = upstream.headers.get(header);
      if (value) response.setHeader(header, value);
    }
    const body = Buffer.from(await upstream.arrayBuffer());
    response.writeHead(upstream.status); response.end(body);
  } catch {
    if (!response.headersSent) response.writeHead(503);
    response.end("The order form is temporarily unavailable.");
  }
}

export function createPublicCatererServer(backendPort: number) {
  return createServer((request, response) => {void forwardPublicCatererRequest(request, response, backendPort);});
}
