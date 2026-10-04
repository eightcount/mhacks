import "dotenv/config";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const moduleName = process.argv[2] === "fetch" ? "fetch_agent.caterer_fetch" : "fetch_agent.caterer";
const env = {...process.env};
if (process.argv[2] === "fetch" && env.FETCH_CATERER_BACKEND_PORT) {
  env.CATERER_BACKEND_PORT = env.FETCH_CATERER_BACKEND_PORT;
}
const result = spawnSync(existsSync(".venv/bin/python") ? ".venv/bin/python" : "python3", ["-m", moduleName], {env, stdio: "inherit"});
if (result.error) console.error("Unable to start Python. Install requirements.txt in .venv.");
process.exit(result.status ?? 1);
