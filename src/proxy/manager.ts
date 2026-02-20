import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ServerConfig } from "../config.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export interface DownstreamServer {
  name: string;
  client: Client;
  transport: StdioClientTransport;
  tools: Tool[];
  config: ServerConfig;
}

export class ServerManager {
  private servers: Map<string, DownstreamServer> = new Map();

  async connectAll(serversConfig: Record<string, ServerConfig>): Promise<void> {
    for (const [name, config] of Object.entries(serversConfig)) {
      try {
        await this.connect(name, config);
        console.log(`[manager] Connected to ${name}, discovered ${this.servers.get(name)!.tools.length} tools`);
      } catch (err) {
        console.error(`[manager] Failed to connect to ${name}:`, err);
      }
    }
  }

  private async connect(name: string, config: ServerConfig): Promise<void> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...process.env, ...config.env } as Record<string, string>,
    });

    const client = new Client({ name: `mcp-platform-${name}`, version: "1.0.0" });
    await client.connect(transport);

    const toolsResult = await client.listTools();
    const tools = toolsResult.tools || [];

    this.servers.set(name, { name, client, transport, tools, config });
  }

  getServer(name: string): DownstreamServer | undefined {
    return this.servers.get(name);
  }

  getAllServers(): Map<string, DownstreamServer> {
    return this.servers;
  }

  async callTool(serverName: string, toolName: string, args: Record<string, unknown>) {
    const server = this.servers.get(serverName);
    if (!server) throw new Error(`Server ${serverName} not found`);
    return server.client.callTool({ name: toolName, arguments: args });
  }

  async shutdown(): Promise<void> {
    for (const [name, server] of this.servers) {
      try {
        await server.transport.close();
        console.log(`[manager] Disconnected from ${name}`);
      } catch (err) {
        console.error(`[manager] Error disconnecting ${name}:`, err);
      }
    }
  }
}
