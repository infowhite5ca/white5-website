import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { invokeMcp } from '../.wrangler/gateway-tests/internal-rpc.mjs';
import { handleGatewayAuthorization, gatewayIdentity } from '../.wrangler/gateway-tests/gateway-auth.mjs';

test('internal RPC waits for asynchronous tool results before closing transports', async () => {
  const server = new McpServer({ name: 'gateway-regression', version: '1' });
  let completed = false;
  server.registerTool('read_probe', { inputSchema: z.object({}) }, async () => {
    await delay(25);
    completed = true;
    return { content: [{ type: 'text', text: 'completed' }] };
  });
  const result = await invokeMcp(server, { method: 'tools/call', name: 'read_probe', arguments: {} });
  assert.equal(completed, true);
  assert.equal(result.content[0].text, 'completed');
});

test('internal RPC returns the registered tool catalog', async () => {
  const server = new McpServer({ name: 'gateway-regression', version: '1' });
  server.registerTool('read_probe', { inputSchema: z.object({}) }, async () => ({ content: [] }));
  const result = await invokeMcp(server, { method: 'tools/list' });
  assert.deepEqual(result.tools.map(tool => tool.name), ['read_probe']);
});

test('gateway keeps registration in its original isolated KV namespace', async () => {
  const writes = [];
  const localKv = { get: async () => null, put: async () => { throw new Error('Wrong OAuth namespace'); } };
  const gatewayKv = { get: async () => null, put: async (key) => { writes.push(key); } };
  const response = await handleGatewayAuthorization(new Request('https://white5-mcp.volodymyronufriichuk68.workers.dev/oauth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'contract-test', redirect_uris: ['http://127.0.0.1:8765/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] }),
  }), { OAUTH_KV: localKv, GATEWAY_OAUTH_KV: gatewayKv }, {});
  assert.equal(response.status, 201);
  assert.ok(writes.some(key => key.startsWith('client:')));
});

test('discovery advertises the canonical White5 resource and scopes', async () => {
  const env = { OAUTH_KV: {}, GATEWAY_OAUTH_KV: { get: async () => null } };
  const response = await handleGatewayAuthorization(new Request('https://white5-mcp.volodymyronufriichuk68.workers.dev/.well-known/oauth-authorization-server'), env, {});
  assert.equal(response.status, 200);
  const metadata = await response.json();
  assert.equal(metadata.issuer, 'https://white5-mcp.volodymyronufriichuk68.workers.dev');
  assert.ok(metadata.scopes_supported.includes('white5:read'));
  assert.ok(metadata.scopes_supported.includes('white5:write'));
});

test('gateway rejects foreign origins and unauthenticated callers', async () => {
  const env = { OAUTH_KV: {}, GATEWAY_OAUTH_KV: { get: async () => null } };
  const foreign = await handleGatewayAuthorization(new Request('https://example.com/oauth/register'), env, {});
  assert.equal(foreign.status, 400);
  const unauthenticated = await handleGatewayAuthorization(new Request('https://white5-mcp.volodymyronufriichuk68.workers.dev/mcp'), env, {});
  assert.equal(unauthenticated.status, 401);
  await assert.rejects(gatewayIdentity(env, 'invalid-token'));
});
