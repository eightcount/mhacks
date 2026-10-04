import { readFileSync, existsSync } from "node:fs";
import { parse } from "dotenv";
import { getPhotonConfig } from '../src/messaging/photon-config.ts';
const env = {...process.env, ...(existsSync('.env') ? parse(readFileSync('.env')) : {})};
const required = ['DATABASE_URL', 'CATERER_ID', 'CATERER_OWNER_USER_ID', 'CATERER_INTERNAL_TOKEN', 'FETCH_CATERER_SEED', 'IMESSAGE_PROJECT_ID', 'IMESSAGE_PROJECT_SECRET', 'CATERER_OWNER_IMESSAGE'];
let ready = true;
for (const key of required) {const present = Boolean(env[key]); console.log(`${key}: ${present ? 'configured' : 'MISSING'}`); ready &&= present;}
if (ready) {
  try {getPhotonConfig(env);}
  catch (error) {console.error(error.message); ready = false;}
}
console.log(`Public order forms: ${env.CATERER_PUBLIC_BASE_URL?.startsWith('https://') ? 'configured' : 'local only; use photon:tunnel or configure an HTTPS host'}`);
console.log(`Grocery shopping: ${env.INSTACART_DEMO_MODE === 'true' ? 'DEMO ONLY — fictional basket; no purchases' : env.INSTACART_API_KEY ? 'Instacart API configured' : 'ingredient list only; no retailer connected'}`);
console.log(ready ? 'Configuration is ready. Run npm run photon:start; then send menu from your configured owner account.' : 'Save the missing values in the local .env, then run this check again. Do not paste secrets into chat.');
process.exitCode = ready ? 0 : 1;
