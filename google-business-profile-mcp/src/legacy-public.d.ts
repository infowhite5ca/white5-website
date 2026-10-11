import type { ConnectorEnv } from './google-client';
declare const handler: ExportedHandler<ConnectorEnv & { MCP_PUBLIC_ORIGIN: string }>;
export default handler;
