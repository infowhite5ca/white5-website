import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { McpServer } from "@modelcontextprotocol/server";

export interface InternalMcpRequest {
  method: "tools/list" | "tools/call";
  name?: string;
  arguments?: Record<string, unknown>;
}

export async function invokeMcp(server: McpServer, request: InternalMcpRequest) {
  const client = new Client({ name: "White5 internal service", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    if (request.method === "tools/list") return await client.listTools();
    if (request.method !== "tools/call" || !request.name) throw new Error("Unsupported internal operation.");
    // Await the response before finally closes the two transports.
    return await client.callTool({ name: request.name, arguments: request.arguments });
  } finally {
    try { await client.close(); }
    finally { await server.close(); }
  }
}
