import { createHash } from "node:crypto";

/** Match only explicit international phone numbers or Apple ID email addresses. */
export function normalizeIMessageHandle(value: string): string | undefined {
  const trimmed = value.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return trimmed.toLowerCase();
  const phone = trimmed.replace(/[\s().-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : undefined;
}
export function photonDigest(...parts: string[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
export function getPhotonConfig(env: NodeJS.ProcessEnv = process.env) {
  const projectId = env.IMESSAGE_PROJECT_ID?.trim(), projectSecret = env.IMESSAGE_PROJECT_SECRET?.trim();
  const owner = normalizeIMessageHandle(env.CATERER_OWNER_IMESSAGE ?? "");
  const token = env.CATERER_INTERNAL_TOKEN;
  if (!projectId || !projectSecret) throw new Error("Set IMESSAGE_PROJECT_ID and IMESSAGE_PROJECT_SECRET in the local .env.");
  if (!owner) throw new Error("Set CATERER_OWNER_IMESSAGE to your international phone number or Apple ID email in .env.");
  if (!token || token.length < 32) throw new Error("Run npm run caterer:configure to configure the internal token.");
  const port = (value: string | undefined, fallback: number) => {
    const parsed = value ? Number(value) : fallback;
    if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) throw new Error("Invalid local port configuration.");
    return parsed;
  };
  return {projectId, projectSecret, owner, token,
    line: env.IMESSAGE_LINE?.trim(),
    backendPort: port(env.CATERER_BACKEND_PORT, 4002),
    agentPort: port(env.CATERER_BRIDGE_PORT, 8003),
    photonPort: port(env.PHOTON_LOCAL_PORT, 4003)};
}
