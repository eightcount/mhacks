import "dotenv/config";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const moduleName = process.argv[2] === "fetch" ? "fetch_agent.caterer_fetch" : "fetch_agent.caterer";
const result = spawnSync(existsSync(".venv/bin/python") ? ".venv/bin/python" : "python3", ["-m", moduleName], {env: process.env, stdio: "inherit"});
if (result.error) console.error("Unable to start Python. Install requirements.txt in .venv.");
process.exit(result.status ?? 1);
