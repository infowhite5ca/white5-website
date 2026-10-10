import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const config = await readFile(join(process.env.APPDATA, 'xdg.config/.wrangler/config/default.toml'), 'utf8');
const token = config.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if (!token) throw new Error('Cloudflare login is unavailable.');
const base = 'https://api.cloudflare.com/client/v4/accounts/bf77f2b4dd0f909b5b1d1d7d89389cc4/workers';
const directory = new URL('../.local/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const name of ['white5-mcp', 'white5-google-business-mcp', 'white5-zoho-mail-mcp', 'white5-square-mcp', 'white5-google-ads-mcp', 'white5-meta-ads-mcp']) {
  const response = await fetch(`${base}/scripts/${name}/settings`, { headers: { authorization: `Bearer ${token}` } });
  const data = await response.json();
  if (!response.ok) throw new Error(`Cloudflare settings failed: ${response.status}`);
  console.log(JSON.stringify({ worker: name, bindings: data.result.bindings.map(b => ({ name: b.name, type: b.type, service: b.service, entrypoint: b.entrypoint, namespace_id: b.namespace_id })), compatibility_date: data.result.compatibility_date, observability: data.result.observability }));
  const source = await fetch(`${base}/services/${name}/environments/production/content`, { headers: { authorization: `Bearer ${token}` } });
  if (!source.ok) throw new Error(`Cloudflare source failed: ${source.status}`);
  const form = await source.formData();
  for (const [part, value] of form) {
    const filename = typeof value === 'string' ? part : value.name;
    console.log(JSON.stringify({ worker: name, module: filename }));
    if (/\.(js|mjs)$/.test(filename)) await writeFile(new URL(`${name}-${filename.replaceAll('/', '_')}`, directory), typeof value === 'string' ? value : await value.text());
  }
}
