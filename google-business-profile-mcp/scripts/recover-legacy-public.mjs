// Recover application code, not bundled dependencies, from the authorized Cloudflare snapshot.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const source=await readFile(new URL('../../white5-mcp/.local/legacy-gbp-index.js',import.meta.url),'utf8');
const start=source.lastIndexOf('// src/index.ts\n');
const end=source.indexOf('/*! Bundled license information:',start);
if(start<0||end<0)throw new Error('Legacy application boundaries not found');
let app=source.slice(start,end).replace(/__name\((\w+), "[^"]+"\);\r?\n/g,'').replace(/static \{\s*\}/g,'');
const header=`// Recovered from deployed white5-google-business-profile-mcp on 2026-10-10.\n// Snapshot SHA256: ${createHash('sha256').update(source).digest('hex')}\n// Existing public OAuth endpoints and three read-only tool schemas are retained.\nimport {McpServer} from '@modelcontextprotocol/server';\nimport oauth_provider_default from '@cloudflare/workers-oauth-provider';\nimport {createMcpHandler, getMcpAuthContext} from 'agents/mcp/server';\nimport {z as external_exports} from 'zod';\nconst createStatelessMcpHandler = createMcpHandler;\n`;
await writeFile(new URL('../src/legacy-public.js',import.meta.url),header+app.replace(/[\t ]+$/gm,''));
console.log('Recovered legacy public interface.');
