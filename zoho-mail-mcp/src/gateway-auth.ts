import OAuthProvider, {
  getOAuthApi,
  type OAuthProviderOptions,
} from "@cloudflare/workers-oauth-provider";
import type { ConnectorEnv, MailAuthProps } from "./zoho-client";
import { authHandler } from "./zoho-auth-handler";
import { gatewayConsent } from "./gateway-consent";

const GATEWAY_ORIGIN = "https://white5-mcp.volodymyronufriichuk68.workers.dev";
const GATEWAY_SCOPES = ["white5:read", "white5:write"];
const READ_SCOPE = "mail:read";
const WRITE_SCOPE = "mail:write";

export const gatewayOptions = {
  apiRoute: "/mcp",
  apiHandler: {
    async fetch(request: Request, env: ConnectorEnv): Promise<Response> {
      try {
        const identity = await gatewayIdentity(env, bearerToken(request));
        return Response.json({ email: identity.props.email, scopes: identity.scopes }, {
          headers: { "cache-control": "no-store" },
        });
      } catch {
        return new Response("Invalid White5 authorization.", { status: 401 });
      }
    },
  },
  defaultHandler: {
    async fetch(request: Request, env: ConnectorEnv): Promise<Response> {
      const path = new URL(request.url).pathname;
      if (path === "/authorize") return gatewayConsent(request, env);
      if (path !== "/oauth/zoho/callback") return new Response("Not found", { status: 404 });
      return authHandler.fetch!(request as Request<unknown, IncomingRequestCfProperties>, env, {} as ExecutionContext);
    },
  },
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  scopesSupported: GATEWAY_SCOPES,
  allowPlainPKCE: false,
  resourceMetadata: {
    resource: `${GATEWAY_ORIGIN}/mcp`,
    authorization_servers: [GATEWAY_ORIGIN],
    scopes_supported: GATEWAY_SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "White5",
  },
  accessTokenTTL: 60 * 60,
  refreshTokenTTL: 60 * 60 * 24 * 90,
  clientRegistrationTTL: 60 * 60 * 24 * 90,
} satisfies OAuthProviderOptions<ConnectorEnv>;

const gatewayProvider = new OAuthProvider<ConnectorEnv>(gatewayOptions);

function gatewayEnv(env: ConnectorEnv): ConnectorEnv {
  if (!env.GATEWAY_OAUTH_KV) throw new Error("Gateway OAuth storage is not configured.");
  const isolated = {
    ...env,
    OAUTH_KV: env.GATEWAY_OAUTH_KV,
    AUTH_SCOPES: GATEWAY_SCOPES,
    AUTH_CALLBACK_ORIGIN: env.SERVICE_ORIGIN || "https://white5-zoho-mail-mcp.volodymyronufriichuk68.workers.dev",
  } as ConnectorEnv;
  isolated.OAUTH_PROVIDER = getOAuthApi(gatewayOptions, isolated);
  return isolated;
}

function bearerToken(request: Request): string {
  const match = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("Missing bearer token.");
  return match[1];
}

export async function gatewayIdentity(
  env: ConnectorEnv,
  token: string,
): Promise<{ scopes: string[]; props: MailAuthProps }> {
  const authorization = await gatewayEnv(env).OAUTH_PROVIDER.unwrapToken<MailAuthProps>(token);
  if (!authorization || authorization.expiresAt <= Math.floor(Date.now() / 1_000)) {
    throw new Error("Gateway access token is invalid or expired.");
  }
  const audience = Array.isArray(authorization.audience)
    ? authorization.audience
    : authorization.audience ? [authorization.audience] : [];
  if (authorization.audience && !audience.includes(`${GATEWAY_ORIGIN}/mcp`)) {
    throw new Error("Gateway access token has the wrong audience.");
  }
  const props = authorization.grant.props;
  const allowedEmail = (env.ALLOWED_ZOHO_EMAIL || "info@white5.ca").toLowerCase();
  if (!props?.email || props.email.toLowerCase() !== allowedEmail) {
    throw new Error("Gateway access token is not for the allowed mailbox.");
  }
  const scopes = authorization.scope.filter(
    (scope) => GATEWAY_SCOPES.includes(scope) && authorization.grant.scope.includes(scope),
  );
  if (!scopes.includes("white5:read")) throw new Error("Gateway read scope is required.");
  return {
    scopes,
    props: {
      ...props,
      scopes: [READ_SCOPE, ...(scopes.includes("white5:write") ? [WRITE_SCOPE] : [])],
    },
  };
}

export function handleGatewayAuthorization(
  request: Request,
  env: ConnectorEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  if (new URL(request.url).origin !== GATEWAY_ORIGIN) {
    return Promise.resolve(new Response("Invalid gateway origin.", { status: 400 }));
  }
  return gatewayProvider.fetch(request, gatewayEnv(env), ctx);
}

export async function handleGatewayCallback(request: Request, env: ConnectorEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") || "";
  if (url.pathname !== "/oauth/zoho/callback" || !state || !env.GATEWAY_OAUTH_KV) return null;
  if (!/^[0-9a-f-]{36}$/i.test(state) || !await env.GATEWAY_OAUTH_KV.get(`zoho-state:${state}`)) return null;
  return authHandler.fetch!(request as Request<unknown, IncomingRequestCfProperties>, gatewayEnv(env), {} as ExecutionContext);
}
