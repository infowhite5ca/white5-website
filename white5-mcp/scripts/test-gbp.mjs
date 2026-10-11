import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const folder = new URL('../.local/test/', import.meta.url);
await mkdir(folder, { recursive: true });
for (const [name, path] of Object.entries({ approved: '../../google-business-profile-mcp/src/approved-project-server.ts', operations: '../../google-business-profile-mcp/src/operations.ts', client: '../../google-business-profile-mcp/src/google-client.ts', auth: '../../google-business-profile-mcp/src/google-auth-handler.ts', stored: '../../google-business-profile-mcp/src/stored-google-token.ts', gateway: '../src/server.ts', health: '../src/health.ts', catalog: '../src/catalog.ts' })) {
  await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], outfile: fileURLToPath(new URL(`${name}.mjs`, folder)), bundle: true, platform: 'node', format: 'esm', external: ['zod', '@modelcontextprotocol/server'], plugins: [{ name: 'worker-runtime-stub', setup(build) {
    build.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'runtime', namespace: 'test' }));
    build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export class WorkerEntrypoint {}' }));
  } }] });
}
const result = spawnSync(process.execPath, ['--test', fileURLToPath(new URL('../tests/gbp.test.mjs', import.meta.url))], { stdio: 'inherit' });
process.exitCode = result.status || 0;
