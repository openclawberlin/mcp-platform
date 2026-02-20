import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { ServerManager } from "./proxy/manager.js";
import { ToolAggregator } from "./proxy/aggregator.js";
import { apiKeyAuth, AuthenticatedRequest } from "./auth/api-key.js";
import { trackUsage, checkRateLimit } from "./tracking/usage.js";
import { getToolCost, checkBalance, deductCost } from "./tracking/billing.js";
import { registerPlatformTools } from "./tools/platform-tools.js";
import { getDb, ensureUser, createApiKey } from "./db/sqlite.js";
import { v4 as uuidv4 } from "uuid";

async function main() {
  const config = loadConfig();
  console.log(`[platform] Starting ${config.platform.name}...`);

  // Init DB
  getDb();

  // Create default user + API key if none exist
  const db = getDb();
  const existingUsers = db.prepare("SELECT COUNT(*) as cnt FROM users").get() as { cnt: number };
  if (existingUsers.cnt === 0) {
    const userId = uuidv4();
    const apiKey = "mcp-platform-demo-key";
    ensureUser(userId, "demo", config.billing.default_credits);
    createApiKey(userId, apiKey);
    console.log(`[platform] Created demo user with API key: ${apiKey}`);
  }

  // Connect to downstream servers
  const manager = new ServerManager();
  await manager.connectAll(config.servers);

  // Aggregate tools
  const aggregator = new ToolAggregator();
  aggregator.buildFromManager(manager);
  console.log(`[platform] Aggregated ${aggregator.getAllTools().length} tools from ${manager.getAllServers().size} servers`);

  // Store current user ID per transport (simple approach)
  let currentUserId = "";

  // Create MCP server
  const mcpServer = new McpServer({
    name: config.platform.name,
    version: "1.0.0",
  });

  // Register platform tools
  registerPlatformTools(mcpServer, aggregator, config, () => currentUserId);

  // Register proxied tools from downstream servers
  for (const tool of aggregator.getAllTools()) {
    const resolved = aggregator.resolve(tool.name)!;
    const inputSchema = (tool.inputSchema || {}) as Record<string, unknown>;
    // Build zod schema from JSON schema properties
    const shape: Record<string, z.ZodTypeAny> = {};
    const props = (inputSchema.properties || {}) as Record<string, { type?: string; description?: string }>;
    for (const [key, prop] of Object.entries(props)) {
      let zType: z.ZodTypeAny = z.any();
      if (prop.type === "string") zType = z.string().optional();
      else if (prop.type === "number") zType = z.number().optional();
      else if (prop.type === "boolean") zType = z.boolean().optional();
      else zType = z.any().optional();
      if (prop.description) zType = zType.describe(prop.description);
      shape[key] = zType;
    }

    mcpServer.tool(
      tool.name,
      tool.description || `Proxied tool from ${resolved.serverName}`,
      shape,
      async (args: Record<string, unknown>) => {
        const userId = currentUserId;
        const cost = getToolCost(resolved.serverName, resolved.originalName, config);

        // Rate limit check
        if (!checkRateLimit(userId, config)) {
          return { content: [{ type: "text" as const, text: "Rate limit exceeded. Try again later." }], isError: true };
        }

        // Balance check
        if (!checkBalance(userId, cost)) {
          return { content: [{ type: "text" as const, text: "Insufficient balance. Add credits first." }], isError: true };
        }

        const start = Date.now();
        const inputSize = JSON.stringify(args).length;
        try {
          const result = await manager.callTool(resolved.serverName, resolved.originalName, args);
          const outputSize = JSON.stringify(result).length;
          const duration = Date.now() - start;
          trackUsage(userId, tool.name, resolved.serverName, duration, inputSize, outputSize, true);
          deductCost(userId, cost);
          return result as { content: Array<{ type: "text"; text: string }>; isError?: boolean };
        } catch (err: unknown) {
          const duration = Date.now() - start;
          const errMsg = err instanceof Error ? err.message : String(err);
          trackUsage(userId, tool.name, resolved.serverName, duration, inputSize, 0, false, errMsg);
          return { content: [{ type: "text" as const, text: `Error: ${errMsg}` }], isError: true };
        }
      }
    );
  }

  // Express HTTP server with SSE transport
  const app = express();
  const transports: Map<string, SSEServerTransport> = new Map();

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", servers: manager.getAllServers().size, tools: aggregator.getAllTools().length });
  });

  app.get("/sse", apiKeyAuth as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
    currentUserId = req.userId || "";
    const transport = new SSEServerTransport("/messages", res);
    transports.set(transport.sessionId, transport);
    res.on("close", () => { transports.delete(transport.sessionId); });
    await mcpServer.connect(transport);
  });

  app.post("/messages", apiKeyAuth as express.RequestHandler, async (req: AuthenticatedRequest, res) => {
    currentUserId = req.userId || "";
    const sessionId = req.query.sessionId as string;
    const transport = transports.get(sessionId);
    if (!transport) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    await transport.handlePostMessage(req, res);
  });

  const port = config.platform.port;
  app.listen(port, () => {
    console.log(`[platform] MCP Platform listening on http://localhost:${port}`);
    console.log(`[platform] SSE endpoint: GET /sse`);
    console.log(`[platform] Health check: GET /health`);
  });

  process.on("SIGINT", async () => {
    console.log("\n[platform] Shutting down...");
    await manager.shutdown();
    process.exit(0);
  });
}

main().catch(console.error);
