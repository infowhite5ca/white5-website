import { build } from 'esbuild';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
await mkdir(new URL('../.local/', import.meta.url), { recursive: true });
const out = new URL('../.local/gbp-tools.mjs', import.meta.url);
await build({ entryPoints: [fileURLToPath(new URL('../../google-business-profile-mcp/src/tools.ts', import.meta.url))], outfile: fileURLToPath(out), platform: 'node', format: 'esm', bundle: true });
const { toolDefinitions } = await import(out.href);
const target = new URL('../src/gbp-tools.json', import.meta.url);
const content = JSON.stringify(toolDefinitions, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (await readFile(target, 'utf8') !== content) throw new Error('GBP gateway catalog is out of date. Run generate-gbp-catalog.mjs.');
} else await writeFile(target, content);
console.log(`GBP catalog: ${toolDefinitions.length} tools.`);
