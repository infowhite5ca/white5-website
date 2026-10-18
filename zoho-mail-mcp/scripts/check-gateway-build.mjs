import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const bindings = Object.fromEntries(config.kv_namespaces.map(binding => [binding.binding, binding.id]));
assert.equal(config.name, 'white5-zoho-mail-mcp');
assert.equal(bindings.OAUTH_KV, '5dae403d1c8b4b65a83ad685c8af0c76');
assert.equal(bindings.GATEWAY_OAUTH_KV, '8bb9b6c595e6489392096b49f23ac399');
const bundle = await readFile(new URL('../dist/server.js', import.meta.url), 'utf8');
const exports = [...bundle.matchAll(/export\s*\{([^}]+)\}/g)].map(match => match[1]).join('\n');
assert.match(exports, /\bWhite5Service\b/, 'White5Service must be a named bundle export');
assert.match(bundle, /class extends WorkerEntrypoint/, 'RPC entrypoint must extend WorkerEntrypoint');
console.log('Gateway deployment contract OK: named White5Service export and both original KV bindings.');
