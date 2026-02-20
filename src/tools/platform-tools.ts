import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getUsageSummary, getUsageByTool, getAllUsers, getRecentUsage } from "../db/sqlite.js";
import { getBillingStatus, addCredits, getToolCost } from "../tracking/billing.js";
import { ToolAggregator } from "../proxy/aggregator.js";
import { PlatformConfig } from "../config.js";

const startTime = Date.now();

export function registerPlatformTools(
  server: McpServer,
  aggregator: ToolAggregator,
  config: PlatformConfig,
  getUserId: () => string
) {
  server.tool("platform.usage_summary", "Get usage summary for current user", {}, async () => {
    const userId = getUserId();
    const summary = getUsageSummary(userId);
    const billing = getBillingStatus(userId);
    return {
      content: [{ type: "text", text: JSON.stringify({ summary, billing }, null, 2) }],
    };
  });

  server.tool("platform.usage_by_tool", "Get detailed per-tool usage stats", {}, async () => {
    const userId = getUserId();
    const stats = getUsageByTool(userId);
    return {
      content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
    };
  });

  server.tool("platform.billing_status", "Get current billing status", {}, async () => {
    const userId = getUserId();
    const status = getBillingStatus(userId);
    return {
      content: [{ type: "text", text: JSON.stringify({ ...status, currency: config.billing.currency }, null, 2) }],
    };
  });

  server.tool("platform.add_credits", "Add mock credits to your account", { amount: z.number().positive().describe("Amount of credits to add") }, async ({ amount }) => {
    const userId = getUserId();
    addCredits(userId, amount);
    const status = getBillingStatus(userId);
    return {
      content: [{ type: "text", text: JSON.stringify({ added: amount, ...status, currency: config.billing.currency }, null, 2) }],
    };
  });

  server.tool("platform.list_servers", "List connected downstream servers and their tools", {}, async () => {
    const toolsByServer = aggregator.getToolsByServer();
    return {
      content: [{ type: "text", text: JSON.stringify(toolsByServer, null, 2) }],
    };
  });

  // Resources
  server.resource("status", "platform://status", async () => ({
    contents: [{
      uri: "platform://status",
      text: JSON.stringify({
        name: config.platform.name,
        uptime_ms: Date.now() - startTime,
        servers: Object.keys(config.servers),
        total_tools: aggregator.getAllTools().length,
      }, null, 2),
    }],
  }));

  server.resource("users", "platform://users", async () => ({
    contents: [{
      uri: "platform://users",
      text: JSON.stringify(getAllUsers(), null, 2),
    }],
  }));

  server.resource("audit-log", "platform://audit-log", async () => ({
    contents: [{
      uri: "platform://audit-log",
      text: JSON.stringify(getRecentUsage(50), null, 2),
    }],
  }));
}
