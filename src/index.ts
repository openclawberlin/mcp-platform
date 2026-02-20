import "dotenv/config";
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

  // ─── Dashboard API routes ───────────────────────────────────────────
  const startTime = Date.now();

  app.get("/api/status", (_req, res) => {
    const servers: { name: string; tools_count: number; tools: string[] }[] = [];
    for (const [name, srv] of manager.getAllServers()) {
      servers.push({ name, tools_count: srv.tools.length, tools: srv.tools.map((t: any) => t.name) });
    }
    res.json({ servers, total_tools: aggregator.getAllTools().length, uptime_seconds: Math.floor((Date.now() - startTime) / 1000) });
  });

  app.get("/api/usage", (_req, res) => {
    const rows = db.prepare("SELECT * FROM usage_log ORDER BY timestamp DESC LIMIT 50").all();
    res.json(rows);
  });

  app.get("/api/billing", (_req, res) => {
    const rows = db.prepare("SELECT u.id, u.name, b.balance, b.total_spent FROM users u LEFT JOIN billing b ON u.id = b.user_id").all();
    res.json(rows);
  });

  app.get("/api/stats", (_req, res) => {
    const totalCalls = (db.prepare("SELECT COUNT(*) as c FROM usage_log").get() as any).c;
    const totalSpent = (db.prepare("SELECT COALESCE(SUM(total_spent),0) as s FROM billing").get() as any).s;
    const cps = db.prepare("SELECT server, COUNT(*) as c FROM usage_log GROUP BY server").all() as any[];
    const callsPerServer: Record<string, number> = {};
    for (const r of cps) callsPerServer[r.server] = r.c;
    const avgDur = (db.prepare("SELECT COALESCE(AVG(duration_ms),0) as a FROM usage_log").get() as any).a;
    res.json({ total_calls: totalCalls, total_spent: totalSpent, calls_per_server: callsPerServer, avg_duration_ms: Math.round(avgDur) });
  });

  app.get("/dashboard", (_req, res) => {
    res.type("html").send(DASHBOARD_HTML);
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

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MCP Platform Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#c9d1d9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;padding:20px}
.mono{font-family:'SF Mono',SFMono-Regular,Consolas,'Liberation Mono',Menlo,monospace}
header{display:flex;align-items:center;justify-content:space-between;padding:16px 24px;background:#161b22;border:1px solid #30363d;border-radius:12px;margin-bottom:20px}
header h1{font-size:24px;color:#fff;display:flex;align-items:center;gap:10px}
header h1 span.logo{background:linear-gradient(135deg,#22c55e,#3b82f6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-weight:800}
.badge{background:#22c55e22;color:#22c55e;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:600}
.header-right{display:flex;align-items:center;gap:16px}
#uptime{color:#8b949e;font-size:14px}
.grid{display:grid;gap:16px;margin-bottom:20px}
.grid-4{grid-template-columns:repeat(4,1fr)}
.grid-2{grid-template-columns:1fr 1fr}
.card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:20px;transition:transform .2s,border-color .2s}
.card:hover{transform:translateY(-2px);border-color:#58a6ff}
.card h3{font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#8b949e;margin-bottom:8px}
.card .big{font-size:36px;font-weight:700;color:#fff}
.dot{width:8px;height:8px;border-radius:50%;background:#22c55e;display:inline-block;margin-right:6px;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes fadeIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
.server-item{padding:12px 0;border-bottom:1px solid #21262d}.server-item:last-child{border:none}
.server-name{font-weight:600;color:#fff;font-size:15px;display:flex;align-items:center;gap:6px}
.tool-count{color:#8b949e;font-size:13px;margin-left:auto}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.chip{font-size:11px;padding:3px 8px;border-radius:6px;font-weight:500}
.chip-firecrawl{background:#f9731622;color:#f97316}.chip-exa{background:#3b82f622;color:#3b82f6}
.chip-fal\\.ai,.chip-fal{background:#a855f722;color:#a855f7}.chip-platform{background:#22c55e22;color:#22c55e}
.chip-default{background:#8b949e22;color:#8b949e}
.feed{max-height:400px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:#30363d #161b22}
.feed-item{padding:10px 0;border-bottom:1px solid #21262d;animation:fadeIn .3s ease;display:grid;grid-template-columns:auto 1fr auto auto;gap:10px;align-items:center;font-size:13px}
.feed-time{color:#8b949e;font-size:12px}.feed-tool{font-weight:600}.feed-dur{color:#8b949e}.feed-cost{color:#22c55e}
.bar-chart{display:flex;align-items:flex-end;gap:16px;height:200px;padding:20px 0}
.bar-wrapper{flex:1;display:flex;flex-direction:column;align-items:center;gap:8px}
.bar{width:100%;border-radius:6px 6px 0 0;transition:height .5s ease;min-height:4px}
.bar-label{font-size:12px;color:#8b949e;text-align:center}
.bar-value{font-size:14px;font-weight:700;color:#fff}
.color-firecrawl{background:#f97316}.color-exa{background:#3b82f6}.color-fal\\.ai,.color-fal{background:#a855f7}.color-platform{background:#22c55e}.color-default{background:#8b949e}
@media(max-width:900px){.grid-4{grid-template-columns:repeat(2,1fr)}.grid-2{grid-template-columns:1fr}}
@media(max-width:600px){.grid-4{grid-template-columns:1fr}}
</style></head><body>
<header>
  <h1>⚡ <span class="logo">MCP Platform</span></h1>
  <div class="header-right">
    <span id="uptime" class="mono">Uptime: 0s</span>
    <span class="badge" id="toolsBadge">0 tools</span>
  </div>
</header>

<div class="grid grid-4" id="statsCards">
  <div class="card"><h3>Total API Calls</h3><div class="big mono" id="sCalls">—</div></div>
  <div class="card"><h3>Total Spent</h3><div class="big mono" id="sSpent">—</div></div>
  <div class="card"><h3>Active Servers</h3><div class="big" id="sServers">—</div></div>
  <div class="card"><h3>Avg Response Time</h3><div class="big mono" id="sAvg">—</div></div>
</div>

<div class="grid grid-2">
  <div class="card"><h3>Connected Servers</h3><div id="serverList"></div></div>
  <div class="card"><h3>Live Usage Feed</h3><div class="feed" id="usageFeed"></div></div>
</div>

<div class="grid" style="margin-top:4px">
  <div class="card"><h3>Calls per Server</h3><div class="bar-chart" id="barChart"></div></div>
</div>

<script>
const SRV_COLORS={firecrawl:'#f97316',exa:'#3b82f6','fal.ai':'#a855f7',fal:'#a855f7',platform:'#22c55e'};
function srvColor(s){return SRV_COLORS[s.toLowerCase()]||'#8b949e'}
function chipClass(s){const k=s.toLowerCase();return SRV_COLORS[k]?'chip-'+k:'chip-default'}
function colorClass(s){const k=s.toLowerCase();return SRV_COLORS[k]?'color-'+k:'color-default'}

async function refresh(){
  try{
    const [status,stats,usage]=await Promise.all([fetch('/api/status').then(r=>r.json()),fetch('/api/stats').then(r=>r.json()),fetch('/api/usage').then(r=>r.json())]);
    document.getElementById('uptime').textContent='Uptime: '+fmtDur(status.uptime_seconds);
    document.getElementById('toolsBadge').textContent=status.total_tools+' tools';
    document.getElementById('sCalls').textContent=stats.total_calls.toLocaleString();
    document.getElementById('sSpent').textContent='$'+stats.total_spent.toFixed(4);
    document.getElementById('sServers').innerHTML=status.servers.length+' <span class="dot"></span>';
    document.getElementById('sAvg').textContent=stats.avg_duration_ms+'ms';

    // servers
    let sh='';
    for(const sv of status.servers){
      sh+='<div class="server-item"><div style="display:flex;align-items:center"><span class="server-name"><span class="dot"></span>'+esc(sv.name)+'</span><span class="tool-count">'+sv.tools_count+' tools</span></div><div class="chips">'+sv.tools.map(t=>'<span class="chip '+chipClass(sv.name)+'">'+esc(t)+'</span>').join('')+'</div></div>';
    }
    document.getElementById('serverList').innerHTML=sh;

    // feed
    let fh='';
    for(const u of usage){
      fh+='<div class="feed-item"><span class="feed-time">'+esc(u.timestamp||'')+'</span><span class="feed-tool" style="color:'+srvColor(u.server)+'">'+esc(u.tool)+'</span><span class="feed-dur mono">'+u.duration_ms+'ms</span><span class="feed-cost mono">'+(u.success?'✓':'✗')+'</span></div>';
    }
    document.getElementById('usageFeed').innerHTML=fh;

    // bar chart
    const cps=stats.calls_per_server;const keys=Object.keys(cps);const max=Math.max(...Object.values(cps),1);
    let bh='';
    for(const k of keys){const pct=(cps[k]/max)*100;bh+='<div class="bar-wrapper"><div class="bar-value">'+cps[k]+'</div><div class="bar '+colorClass(k)+'" style="height:'+pct+'%"></div><div class="bar-label">'+esc(k)+'</div></div>';}
    if(!keys.length)bh='<div style="color:#8b949e;margin:auto">No data yet</div>';
    document.getElementById('barChart').innerHTML=bh;
  }catch(e){console.error(e)}
}
function fmtDur(s){const h=Math.floor(s/3600),m=Math.floor(s%3600/60),sec=s%60;return (h?h+'h ':'')+(m?m+'m ':'')+sec+'s'}
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
refresh();setInterval(refresh,3000);
</script></body></html>`;

main().catch(console.error);
