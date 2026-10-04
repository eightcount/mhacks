import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { resolve } from 'node:path';
import { createPublicCatererServer } from '../src/messaging/photon-public.ts';

const env = {...process.env, ...(existsSync('.env') ? parse(readFileSync('.env')) : {})};
const port = Number(env.PHOTON_PUBLIC_PORT || 4004), backendPort = Number(env.PHOTON_BACKEND_PORT || 4005);
if (![port, backendPort].every(p => Number.isInteger(p) && p >= 1024 && p <= 65535)) throw new Error('Invalid local port configuration');
const provider = env.PHOTON_TUNNEL_PROVIDER || 'cloudflare';
if (!['cloudflare', 'localhost-run'].includes(provider)) throw new Error('PHOTON_TUNNEL_PROVIDER must be cloudflare or localhost-run');
const server = createPublicCatererServer(backendPort);
let child;
const stop = () => {child?.kill('SIGTERM'); server.close();};
process.once('SIGINT', stop); process.once('SIGTERM', stop);
server.on('error', () => {console.error('Public form gateway could not start; check PHOTON_PUBLIC_PORT.'); process.exitCode = 1; stop();});
server.listen(port, '127.0.0.1', () => {
  const binary = existsSync('artifacts/bin/cloudflared') ? 'artifacts/bin/cloudflared' : 'cloudflared';
  mkdirSync('artifacts', {recursive: true});
  const logPath = 'artifacts/photon-tunnel.log';
  writeFileSync(logPath, '', {mode: 0o600});
  const args = provider === 'cloudflare'
    ? ['tunnel', '--no-autoupdate', '--protocol', 'auto', '--edge-ip-version', '4',
      '--loglevel', 'info', '--logfile', logPath, '--url', `http://127.0.0.1:${port}`]
    : ['-F', '/dev/null', '-o', 'IdentityAgent=none', '-o', 'IdentitiesOnly=yes', '-o', 'IdentityFile=none',
      '-o', `UserKnownHostsFile=${resolve('artifacts/localtunnel_known_hosts')}`, '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3',
      '-o', 'ConnectTimeout=10', '-T', '-R', `80:127.0.0.1:${port}`, 'nokey@localhost.run', '--', '--output', 'json'];
  child = spawn(provider === 'cloudflare' ? binary : 'ssh', args, {stdio: ['ignore', 'pipe', 'pipe']});
  let buffer = '', pendingLines = '', saved = false, connected = false, tunnelUrl;
  const logs = chunk => {
    if (provider === 'cloudflare') {
      buffer = (buffer + String(chunk)).slice(-20000);
      tunnelUrl ||= buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
      connected ||= buffer.includes('Registered tunnel connection');
    } else {
      pendingLines += String(chunk);
      const lines = pendingLines.split(/\r?\n/); pendingLines = (lines.pop() || '').slice(-30000);
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (event.type !== 'v1.tcpip_forward.register.accepted' || typeof event.data !== 'string') continue;
          tunnelUrl = event.data.match(/https:\/\/[a-z0-9-]+\.(?:lhr\.life|localhost\.run)\b/)?.[0];
          connected = Boolean(tunnelUrl);
        } catch { /* Ignore SSH banners; do not log request metadata or QR output. */ }
      }
    }
    if (!tunnelUrl || saved || !connected) return;
    const url = tunnelUrl;
    saved = true;
    // Only the public URL is changed. Existing local secrets remain local.
    let content = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
    const line = `CATERER_PUBLIC_BASE_URL=${url}`;
    content = /^CATERER_PUBLIC_BASE_URL=.*$/m.test(content) ? content.replace(/^CATERER_PUBLIC_BASE_URL=.*$/m, line) : `${content.trimEnd()}\n${line}\n`;
    writeFileSync('.env', content, {mode: 0o600});
    console.log('Temporary HTTPS form link configured in .env. Keep this terminal running.');
    console.log('Now start (or restart) npm run photon:start in another terminal. The link changes when this tunnel restarts.');
  };
  child.stdout.on('data', logs); child.stderr.on('data', logs);
  child.once('error', () => {console.error('The tunnel provider could not start: see docs/photon-imessage.md.'); process.exitCode = 1; server.close();});
  child.once('exit', code => {server.close(); if (code) {console.error('The temporary form tunnel stopped. Restart it before sharing forms.'); process.exitCode = 1;}});
});
