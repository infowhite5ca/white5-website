import legacyPublic from './legacy-public.js';
import { authHandler } from './google-auth-handler';
import type { ConnectorEnv } from './google-client';

// Preserve the original public connector. Add the modern private service binding
// and one-time encrypted gateway authorization using this Worker's existing client.
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const install = url.pathname === '/oauth/google/install' && request.method === 'GET';
    const state = url.searchParams.get('state');
    const installCallback = url.pathname === '/oauth/google/callback' && request.method === 'GET'
      && state && /^[0-9a-f-]{36}$/.test(state)
      && await env.OAUTH_KV.get(`google-install-state:${state}`);
    if (install || installCallback) return authHandler.fetch!(request, env, ctx);
    return legacyPublic.fetch!(request, env, ctx);
  },
} satisfies ExportedHandler<ConnectorEnv & { MCP_PUBLIC_ORIGIN: string }>;

export { White5Service } from './service';
