import "dotenv/config";
import { spawnSync } from "node:child_process";

const mode = process.argv[2];
const moduleName = mode === "cli"
  ? "fetch_agent.local_cli"
  : mode === "fetch" ? "fetch_agent.fetch_agent" : undefined;

if (!moduleName) {
  console.error("Choose an agent mode: cli or fetch.");
  process.exit(1);
}

const result = spawnSync("python3", ["-m", moduleName], {
  env: process.env,
  stdio: "inherit"
});

if (result.error) {
  console.error("Unable to start python3. Activate .venv and install requirements.txt.");
  process.exit(1);
}

if (result.signal) {
  process.kill(process.pid, result.signal);
} else {
  process.exit(result.status ?? 1);
}
