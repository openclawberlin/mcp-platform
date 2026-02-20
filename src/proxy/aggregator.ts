import { ServerManager } from "./manager.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export interface NamespacedTool {
  serverName: string;
  originalName: string;
  namespacedName: string;
  tool: Tool;
}

export class ToolAggregator {
  private tools: Map<string, NamespacedTool> = new Map();

  buildFromManager(manager: ServerManager): void {
    this.tools.clear();
    for (const [serverName, server] of manager.getAllServers()) {
      for (const tool of server.tools) {
        const namespacedName = `${serverName}.${tool.name}`;
        this.tools.set(namespacedName, {
          serverName,
          originalName: tool.name,
          namespacedName,
          tool: { ...tool, name: namespacedName },
        });
      }
    }
  }

  getAllTools(): Tool[] {
    return Array.from(this.tools.values()).map((t) => t.tool);
  }

  resolve(namespacedName: string): NamespacedTool | undefined {
    return this.tools.get(namespacedName);
  }

  getToolsByServer(): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const t of this.tools.values()) {
      if (!result[t.serverName]) result[t.serverName] = [];
      result[t.serverName].push(t.originalName);
    }
    return result;
  }
}
