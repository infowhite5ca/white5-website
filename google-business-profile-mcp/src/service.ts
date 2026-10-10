import { WorkerEntrypoint } from "cloudflare:workers";
import { type ConnectorEnv, type GoogleAuthProps } from "./google-client";
import { loadInternalGoogleRefreshToken } from "./stored-google-token";
import { invoke, failed, toolDefinitions, safeError } from "./operations";
import { type ToolName } from "./tools";
export interface InternalMcpRequest { method: "tools/list" | "tools/call"; name?: string; arguments?: Record<string, unknown> }
export class White5Service extends WorkerEntrypoint<ConnectorEnv> {
  async status() {
    const response = await this.rpc({ method: "tools/call", name: "connection_status" });
    const result = JSON.parse(response.content![0].text);
    return { configured: !response.isError && result.connected === true, connected: !response.isError && result.connected === true, capabilities: result.capabilities, category: result.category };
  }
  async rpc(request: InternalMcpRequest): Promise<any> {
    try {
      if (request.method === "tools/list") return { tools: toolDefinitions };
      const refreshToken = await loadInternalGoogleRefreshToken(this.env);
      const props: GoogleAuthProps | undefined = refreshToken && this.env.ALLOWED_GOOGLE_EMAIL ? { userId: "white5-internal-google-business", email: this.env.ALLOWED_GOOGLE_EMAIL, refreshToken, scopes: ["business:read", "business:write"] } : undefined;
      return await invoke(this.env, props, request.name as ToolName, request.arguments || {});
    } catch (error) { return failed(error); }
  }
}
