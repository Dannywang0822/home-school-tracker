import { build } from 'esbuild';
import { readdirSync, statSync } from 'node:fs';

const names = readdirSync('functions').filter((name) => {
  if (!name.startsWith('hst_')) return false;
  return statSync(`functions/${name}/src/index.ts`, { throwIfNoEntry: false })?.isFile();
});

if (names.length === 0) {
  console.error('No hst_ functions found');
  process.exit(1);
}

for (const name of names) {
  await build({
    entryPoints: [`functions/${name}/src/index.ts`],
    outfile: `functions/${name}/index.js`,
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    external: ['@cloudbase/node-sdk'],
    logLevel: 'warning',
  });
  console.log(`built functions/${name}/index.js`);
}
