import { readFileSync } from 'node:fs';

const apply = process.argv.includes('--apply');
const acknowledged = process.argv.includes('--i-know-this-env-is-shared');
const rules = JSON.parse(readFileSync(new URL('../infra/rules/database.json', import.meta.url), 'utf8'));
const config = JSON.parse(readFileSync(new URL('../cloudbaserc.json', import.meta.url), 'utf8'));

const badCollections = Object.keys(rules).filter((name) => !name.startsWith('hst_'));
const badFunctions = config.functions.filter((fn) => !fn.name.startsWith('hst_'));
if (badCollections.length || badFunctions.length) {
  console.error('Refusing to deploy: a name is missing the hst_ prefix.');
  process.exit(1);
}

console.log('Shared CloudBase environment. This deploy touches only hst_ functions, collections and storage paths.');
console.log(`Functions: ${config.functions.map((fn) => fn.name).join(', ')}`);
console.log(`Collections: ${Object.keys(rules).length}`);
console.log('Storage prefixes: hst_tmp/ , hst_vault/');
console.log('Cron expressions are 7-field. Confirm the trigger timezone in the console before enabling them.');
console.log('Credentials are read from TENCENTCLOUD_SECRETID and TENCENTCLOUD_SECRETKEY. They are never printed.');
console.log('User import stays local until those keys exist. It does not call CloudBase CreateUser.');

if (!apply) {
  console.log('Dry run only. Re-run with --apply --i-know-this-env-is-shared after TCB_ENV_ID and CAM keys are set.');
  process.exit(0);
}

const missing = ['TCB_ENV_ID', 'TENCENTCLOUD_SECRETID', 'TENCENTCLOUD_SECRETKEY'].filter((key) => !process.env[key]);
if (missing.length || !acknowledged) {
  console.error(`Refusing to apply. Missing: ${missing.join(', ') || 'none'}. Acknowledgement flag: ${acknowledged}`);
  process.exit(1);
}

console.log(`Apply requested for env id length ${process.env.TCB_ENV_ID.length}.`);
console.log('Week 1 does not invoke the CloudBase CLI. Build with npm run build:functions, substitute envId, then run tcb fn deploy for each hst_ function.');
process.exit(0);
