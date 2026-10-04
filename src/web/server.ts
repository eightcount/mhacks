import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { getCatererDashboard } from "../services/dashboard.js";
import { DomainError, type DomainErrorCode } from "../services/errors.js";

// Local-only until real authentication exists: the actor ID comes from the URL.
const host = "127.0.0.1";
const port = Number(process.env.DASHBOARD_PORT) || 3000;
const publicDirectory = new URL("./public/", import.meta.url);

const staticFiles: Record<string, { file: string; contentType: string }> = {
  "/": { file: "index.html", contentType: "text/html; charset=utf-8" },
  "/styles.css": { file: "styles.css", contentType: "text/css; charset=utf-8" },
  "/app.js": { file: "app.js", contentType: "text/javascript; charset=utf-8" }
};

const dashboardRoute = /^\/api\/caterers\/([^/]+)\/dashboard$/;

const domainErrorStatus: Partial<Record<DomainErrorCode, number>> = {
  CATERER_NOT_FOUND: 404,
  UNAUTHORIZED_CATERER: 403
};

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

async function serveDashboard(
  response: ServerResponse,
  catererId: string,
  searchParams: URLSearchParams
): Promise<void> {
  const today = searchParams.get("today");
  const month = searchParams.get("month");
  try {
    const dashboard = await getCatererDashboard({
      catererId,
      actorUserId: searchParams.get("actorUserId") ?? "",
      ...(today ? { today } : {}),
      ...(month ? { month } : {})
    });
    sendJson(response, 200, dashboard);
  } catch (error) {
    if (error instanceof ZodError) {
      sendJson(response, 400, { error: "INVALID_REQUEST" });
    } else if (error instanceof DomainError) {
      sendJson(response, domainErrorStatus[error.code] ?? 400, { error: error.code });
    } else {
      console.error("Dashboard request failed. Check DATABASE_URL and Neon connectivity.");
      sendJson(response, 500, { error: "INTERNAL_ERROR" });
    }
  }
}

async function serveStaticFile(
  response: ServerResponse,
  { file, contentType }: { file: string; contentType: string }
): Promise<void> {
  try {
    const body = await readFile(new URL(file, publicDirectory));
    response.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-cache" });
    response.end(body);
  } catch {
    response.writeHead(500).end();
  }
}

const server = createServer((request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method !== "GET") {
    response.writeHead(405, { Allow: "GET" }).end();
    return;
  }

  const url = new URL(request.url ?? "/", `http://${host}`);
  const dashboardMatch = dashboardRoute.exec(url.pathname);
  if (dashboardMatch) {
    void serveDashboard(response, dashboardMatch[1] ?? "", url.searchParams);
    return;
  }

  const staticFile = staticFiles[url.pathname];
  if (staticFile) {
    void serveStaticFile(response, staticFile);
    return;
  }

  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code !== "EADDRINUSE") throw error;
  console.error(
    `Port ${port} is already in use, probably by another dashboard server. Stop it, or set DASHBOARD_PORT to a free port.`
  );
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.info(`Dishpatch caterer dashboard running at http://localhost:${port}/`);
});
