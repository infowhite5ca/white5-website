import { WorkerEntrypoint } from "cloudflare:workers";
import { createServer } from "./server";
import { invokeMcp, type InternalMcpRequest } from "./internal-rpc";
import { gatewayIdentity, handleGatewayAuthorization } from "./gateway-auth";
import type { ConnectorEnv } from "./zoho-client";

function errorResult(service: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected internal connector error.";
  return {
    isError: true,
    content: [{ type: "text", text: `${service}: ${message.slice(0, 1_000)}` }],
  };
}

function sanitizeResult<T>(value: T, env: Partial<ConnectorEnv> & Record<string, unknown>): T {
  const secrets = [
    env.ZOHO_CLIENT_ID,
    env.ZOHO_CLIENT_SECRET,
    env.REFRESH_TOKEN,
    env.GATEWAY_ACCESS_TOKEN,
  ].filter((secret): secret is string => typeof secret === "string" && secret.length > 0);
  const blockedKeys = /^(access_token|refresh_token|client_secret|authorization|gateway_access_token)$/i;
  const visit = (input: unknown): unknown => {
    if (typeof input === "string") {
      return secrets.reduce((result, secret) => result.replaceAll(secret, "[REDACTED]"), input);
    }
    if (Array.isArray(input)) return input.map(visit);
    if (input && typeof input === "object") {
      return Object.fromEntries(Object.entries(input).map(([key, item]) => [key, blockedKeys.test(key) ? "[REDACTED]" : visit(item)]));
    }
    return input;
  };
  return visit(value) as T;
}

export class White5Service extends WorkerEntrypoint<ConnectorEnv> {
  status() {
    return {
      configured: Boolean(this.env.ZOHO_CLIENT_ID && this.env.ZOHO_CLIENT_SECRET && this.env.GATEWAY_OAUTH_KV),
    };
  }

  authorize(request: Request): Promise<Response> {
    return handleGatewayAuthorization(request, this.env, this.ctx);
  }

  async rpc(request: InternalMcpRequest, gatewayAccessToken?: string) {
    try {
      const identity = request.method === "tools/call"
        ? await gatewayIdentity(this.env, gatewayAccessToken || "")
        : undefined;
      const result = await invokeMcp(createServer(this.env, identity?.props), request);
      return sanitizeResult(result, {
        ...this.env,
        REFRESH_TOKEN: identity?.props.refreshToken,
        GATEWAY_ACCESS_TOKEN: gatewayAccessToken,
      });
    } catch (error) {
      return sanitizeResult(errorResult("zoho", error), {
        ...this.env,
        GATEWAY_ACCESS_TOKEN: gatewayAccessToken,
      });
    }
  }
}
