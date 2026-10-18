import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const directory = new URL('../.wrangler/gateway-tests/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const name of ['internal-rpc', 'gateway-auth']) {
  await build({
    entryPoints: [fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url))],
    outfile: fileURLToPath(new URL(`${name}.mjs`, directory)),
    bundle: true, platform: 'node', format: 'esm',
    external: ['zod', '@modelcontextprotocol/server', '@modelcontextprotocol/client'],
    plugins: [{ name: 'worker-runtime-stub', setup(builder) {
      builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'runtime', namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export class WorkerEntrypoint {};' }));
    } }],
  });
}
const result = spawnSync(process.execPath, ['--test', fileURLToPath(new URL('../tests/gateway.test.mjs', import.meta.url))], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
