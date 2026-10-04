// Import an existing Photon project's secret without printing it or scaffolding
// over the application. The device login requires approval in the user's browser.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { parse } from 'dotenv';

const cli = 'artifacts/photon-cli/node_modules/@photon-ai/cli/dist/photon.js';
const config = existsSync('.env') ? parse(readFileSync('.env')) : {};
const projectId = config.IMESSAGE_PROJECT_ID;
if (!projectId) {
  console.error('Set IMESSAGE_PROJECT_ID in the local .env first.');
  process.exit(1);
}
const env = {...process.env, PHOTON_CONFIG_DIR: resolve('artifacts/photon-auth'),
  PHOTON_API_HOST: 'https://app.photon.codes', PHOTON_PROJECT_ID: projectId,
  PHOTON_DEBUG: '0', PHOTON_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1'};

function run(command, args, showLogin = false) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {env, stdio: ['ignore', 'pipe', 'pipe']});
    let output = '', loginLines = '';
    child.stdout.on('data', chunk => {
      output += String(chunk);
      if (!showLogin) return;
      loginLines += String(chunk);
      const lines = loginLines.split(/\r?\n/); loginLines = lines.pop() || '';
      for (const raw of lines) {
        const line = raw.replace(/\u001b\[[0-9;]*m/g, '').trim();
        // Only user-facing device instructions are exposed, never CLI tokens,
        // raw errors, project metadata, or the logged-in account's email.
        if (/^Visit: https:\/\/app\.photon\.codes\//.test(line) || /^Code:\s+[A-Z0-9-]+$/.test(line)) console.log(line);
      }
    });
    child.stderr.resume();
    child.once('error', reject);
    child.once('exit', code => resolveResult({code, output}));
    const stop = () => child.kill('SIGTERM');
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    child.once('close', () => {process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);});
  });
}

async function main() {
  if (!existsSync(cli)) {
    console.log('Installing the official Photon setup CLI in ignored local artifacts.');
    const install = await run('npm', ['install', '--prefix', 'artifacts/photon-cli', '--save-exact', '@photon-ai/cli@2.2.0', '--no-audit', '--no-fund']);
    if (install.code !== 0) throw new Error('Photon CLI installation failed.');
  }
  const identity = await run(process.execPath, [cli, 'whoami', '--json']);
  if (identity.code !== 0) {
    console.log('Approve the Photon CLI sign-in using the following link and code.');
    const login = await run(process.execPath, [cli, 'login', '--no-browser'], true);
    if (login.code !== 0) throw new Error('Photon sign-in was not completed. Run npm run photon:connect to retry.');
  }
  const result = await run(process.execPath, [cli, 'projects', 'secret', '--project', projectId, '--json']);
  if (result.code !== 0) throw new Error('Could not read the existing project secret. Check access and the project API secret in Photon settings.');
  const value = JSON.parse(result.output);
  if (value.id !== projectId || typeof value.projectSecret !== 'string' || !/^[\w.-]{16,512}$/.test(value.projectSecret)) throw new Error('Photon did not return a valid secret for the selected project.');
  let content = readFileSync('.env', 'utf8');
  if (parse(content).IMESSAGE_PROJECT_ID !== projectId) throw new Error('The selected project changed during login. Run photon:connect again.');
  const line = `IMESSAGE_PROJECT_SECRET=${value.projectSecret}`;
  content = /^IMESSAGE_PROJECT_SECRET=.*$/m.test(content) ? content.replace(/^IMESSAGE_PROJECT_SECRET=.*$/m, () => line) : `${content.trimEnd()}\n${line}\n`;
  writeFileSync('.env', content, {mode: 0o600});
  console.log('Existing Photon project secret saved securely in local .env.');
  console.log(parse(content).CATERER_OWNER_IMESSAGE ? 'Run npm run photon:check to check readiness.' : 'Set CATERER_OWNER_IMESSAGE in local .env to your personal international phone number or Apple ID email.');
}
main().catch(error => {
  // Messages below are fixed application text; never print subprocess output.
  const safeMessages = new Set(['Photon CLI installation failed.', 'Photon sign-in was not completed. Run npm run photon:connect to retry.',
    'Could not read the existing project secret. Check access and the project API secret in Photon settings.',
    'Photon did not return a valid secret for the selected project.', 'The selected project changed during login. Run photon:connect again.']);
  console.error(safeMessages.has(error.message) ? error.message : 'Photon setup could not complete. Check your connection and try again.');
  process.exitCode = 1;
});
