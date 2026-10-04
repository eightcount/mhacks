import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { resolve } from 'node:path';
import { createPublicCatererServer } from '../src/messaging/photon-public.ts';

const env = {...process.env, ...(existsSync('.env') ? parse(readFileSync('.env')) : {})};
const port = Number(env.PHOTON_PUBLIC_PORT || 4004), backendPort = Number(env.PHOTON_BACKEND_PORT || 4005);
if (![port, backendPort].every(p => Number.isInteger(p) && p >= 1024 && p <= 65535)) throw new Error('Invalid local port configuration');
const provider = env.PHOTON_TUNNEL_PROVIDER || 'cloudflare';
if (!['cloudflare', 'localhost-run', 'pinggy'].includes(provider)) throw new Error('PHOTON_TUNNEL_PROVIDER must be cloudflare, localhost-run, or pinggy');
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
  const pinggyKey = resolve('artifacts/pinggy_tunnel_key');
  if (provider === 'pinggy' && !existsSync(pinggyKey)) {
    const generated = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'catering-document-tunnel', '-f', pinggyKey], {stdio: 'ignore'});
    if (generated.status !== 0) {console.error('Could not create the dedicated local tunnel key.'); process.exitCode = 1; server.close(); return;}
  }
  const args = provider === 'cloudflare'
    ? ['tunnel', '--no-autoupdate', '--protocol', 'auto', '--edge-ip-version', '4',
      '--loglevel', 'info', '--logfile', logPath, '--url', `http://127.0.0.1:${port}`]
    : provider === 'pinggy'
    ? ['-F', '/dev/null', '-p', '443', '-o', 'BatchMode=yes', '-o', 'IdentityAgent=none', '-o', 'IdentitiesOnly=yes', '-i', pinggyKey,
      '-o', `UserKnownHostsFile=${resolve('artifacts/pinggy_known_hosts')}`, '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3',
      '-o', 'ConnectTimeout=10', '-T', '-R', `0:127.0.0.1:${port}`, '--', 'free@free.pinggy.io', 'x:https']
    : ['-F', '/dev/null', '-o', 'IdentityAgent=none', '-o', 'IdentitiesOnly=yes', '-o', 'IdentityFile=none',
      '-o', `UserKnownHostsFile=${resolve('artifacts/localtunnel_known_hosts')}`, '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3',
      '-o', 'ConnectTimeout=10', '-T', '-R', `80:127.0.0.1:${port}`, 'nokey@localhost.run', '--', '--output', 'json'];
  child = spawn(provider === 'cloudflare' ? binary : 'ssh', args, {stdio: ['ignore', 'pipe', 'pipe']});
  let buffer = '', pendingLines = '', saved = false, connected = false, tunnelUrl, verifying = false;
  const publish = async url => {
    verifying = true;
    // Confirm trusted HTTPS and routing to our restricted gateway before issuing links.
    let ready = false;
    for (let attempt = 0; attempt < 10 && child.exitCode === null; attempt++) {
      try {
        const response = await fetch(url, {redirect: 'error', signal: AbortSignal.timeout(5000)});
        if (response.status === 404 && (await response.text()) === 'Not found') {ready = true; break;}
      } catch { /* Certificates and DNS can take a moment to become available. */ }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!ready) {console.error('Tunnel HTTPS verification failed. The public URL was not changed; restart the tunnel or try another provider.'); verifying = false; return;}
    saved = true;
    // Only the public URL is changed. Existing local secrets remain local.
    let content = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
    const line = `CATERER_PUBLIC_BASE_URL=${url}`;
    content = /^CATERER_PUBLIC_BASE_URL=.*$/m.test(content) ? content.replace(/^CATERER_PUBLIC_BASE_URL=.*$/m, line) : `${content.trimEnd()}\n${line}\n`;
    writeFileSync('.env', content, {mode: 0o600});
    console.log('Verified server-side HTTPS access and configured the temporary link in .env. Keep this terminal running.');
    if (provider === 'pinggy') console.log('Pinggy free tunnels expire after 60 minutes. Their browser welcome screen can block Spectrum cards; use the Safari controls link, or host without a welcome screen for native cards.');
    console.log('Now start (or restart) npm run photon:start in another terminal. Request a new receipt or form link after a tunnel restart.');
  };
  const logs = chunk => {
    if (provider === 'cloudflare') {
      buffer = (buffer + String(chunk)).slice(-20000);
      tunnelUrl ||= buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
      connected ||= buffer.includes('Registered tunnel connection');
    } else if (provider === 'pinggy') {
      buffer = (buffer + String(chunk)).slice(-20000);
      tunnelUrl ||= buffer.match(/https:\/\/[a-z0-9-]+\.run\.pinggy-free\.link\b/)?.[0];
      connected = Boolean(tunnelUrl);
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
    if (!tunnelUrl || saved || verifying || !connected) return;
    void publish(tunnelUrl).catch(() => {console.error('Could not save the verified public URL.'); process.exitCode = 1; stop();});
  };
  child.stdout.on('data', logs); child.stderr.on('data', logs);
  child.once('error', () => {console.error('The tunnel provider could not start: see docs/photon-imessage.md.'); process.exitCode = 1; server.close();});
  child.once('exit', code => {server.close(); if (code) {console.error('The temporary form tunnel stopped. Restart it before sharing forms.'); process.exitCode = 1;}});
});
