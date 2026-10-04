import { readFileSync, existsSync } from 'node:fs';
import { parse } from 'dotenv';
import { spawn } from 'node:child_process';
import { getPhotonConfig } from '../src/messaging/photon-config.ts';

const env = {...process.env, ...parse(readFileSync('.env'))};
const required = ['DATABASE_URL', 'CATERER_ID', 'CATERER_OWNER_USER_ID', 'IMESSAGE_PROJECT_ID', 'IMESSAGE_PROJECT_SECRET', 'CATERER_OWNER_IMESSAGE', 'CATERER_INTERNAL_TOKEN', 'FETCH_CATERER_SEED'];
const missing = required.filter(key => !env[key]);
if (missing.length) {console.error(`Missing local configuration: ${missing.join(', ')}. Run npm run photon:check.`); process.exit(1);}
// A dedicated backend keeps an existing local CLI/customer demo undisturbed.
env.CATERER_BACKEND_PORT = env.PHOTON_BACKEND_PORT || '4005';
env.CATERER_BRIDGE_PORT ||= '8003';
env.PHOTON_LOCAL_PORT ||= '4003';
try {getPhotonConfig(env);} catch (error) {console.error(error.message); process.exit(1);}
if (new Set([env.CATERER_BACKEND_PORT, env.CATERER_BRIDGE_PORT, env.PHOTON_LOCAL_PORT]).size !== 3) {
  console.error('Choose distinct ports for the backend, bridge, and Photon connection.'); process.exit(1);
}
env.CATERER_NOTIFICATION_WEBHOOK_URL = `http://127.0.0.1:${env.PHOTON_LOCAL_PORT}/notifications/send`;
env.CATERER_NOTIFICATION_WEBHOOK_TOKEN = env.CATERER_INTERNAL_TOKEN;
if (!env.CATERER_PUBLIC_BASE_URL || /^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(env.CATERER_PUBLIC_BASE_URL)) env.CATERER_PUBLIC_BASE_URL = `http://127.0.0.1:${env.CATERER_BACKEND_PORT}`;
const children = [];
let stopping = false;
const stop = code => {
  if (stopping) return; stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => {for (const child of children) child.kill('SIGKILL'); process.exit(code);}, 2500).unref();
  process.exitCode = code;
};
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => stop(0));
const start = (command, args, name) => {
  const child = spawn(command, args, {env, stdio: ['ignore', 'pipe', 'pipe']}); children.push(child);
  // Emit only our fixed status lines, not SDK logs or possibly sensitive errors.
  child.stdout.on('data', chunk => {for (const line of String(chunk).split('\n')) if (/^\[(photon|caterer-api|caterer-bridge)\]/.test(line)) console.log(line);});
  child.stderr.on('data', chunk => {for (const line of String(chunk).split('\n')) if (/^\[photon\]/.test(line)) console.error(line);});
  child.once('error', () => {console.error(`${name} could not start.`); stop(1);});
  child.once('exit', code => {if (!stopping) {console.error(`${name} exited (code ${code}). Check configuration and port availability.`); stop(code || 1);}});
};
async function waitFor(url, accepts) {
  for (let attempt = 0; attempt < 80 && !stopping; attempt++) {
    try {const r=await fetch(url,{signal:AbortSignal.timeout(1000)}); if (await accepts(r)) return;} catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Startup timed out');
}
try {
  start('node', ['--import','tsx','src/agent/caterer-api.ts'], 'Caterer backend');
  await waitFor(`http://127.0.0.1:${env.CATERER_BACKEND_PORT}/health`, async r => r.ok && (await r.json()).features?.includes('photon'));
  start(existsSync('.venv/bin/python') ? '.venv/bin/python' : 'python3', ['-m','fetch_agent.caterer_bridge'], 'Fetch caterer bridge');
  await waitFor(`http://127.0.0.1:${env.CATERER_BRIDGE_PORT}/caterer/health`, async r => r.ok && (await r.json()).service === 'caterer-fetch-bridge');
  start('node', ['--import','tsx','src/messaging/photon.ts'], 'Photon connection');
} catch {console.error('Photon startup failed. Check ports 4005, 8003, and 4003 and the local configuration.'); stop(1);}
