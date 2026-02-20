import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const API_KEY = "mcp-platform-demo-key";

async function demo() {
  console.log("🚀 MCP Platform Demo\n");

  // Connect via SSE
  const url = new URL("http://localhost:3000/sse");
  const transport = new SSEClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${API_KEY}` } },
    eventSourceInit: { fetch: (url, init) => fetch(url, { ...init, headers: { ...((init as any)?.headers || {}), Authorization: `Bearer ${API_KEY}` } }) },
  });

  const client = new Client({ name: "demo-client", version: "1.0.0" });
  await client.connect(transport);
  console.log("✅ Connected to MCP Platform\n");

  // 1. List all available tools
  console.log("━━━ TEST 1: List All Tools ━━━");
  const tools = await client.listTools();
  const toolNames = tools.tools.map((t: any) => t.name);
  console.log(`Found ${toolNames.length} tools:`);
  
  // Group by server
  const groups: Record<string, string[]> = {};
  for (const name of toolNames) {
    const [server, ...rest] = name.split(".");
    const toolName = rest.join(".") || server;
    if (!groups[server]) groups[server] = [];
    groups[server].push(toolName);
  }
  for (const [server, tools] of Object.entries(groups)) {
    console.log(`\n  📦 ${server} (${tools.length} tools):`);
    for (const t of tools.slice(0, 5)) console.log(`     • ${t}`);
    if (tools.length > 5) console.log(`     ... and ${tools.length - 5} more`);
  }
  console.log();

  // 2. List servers
  console.log("━━━ TEST 2: List Connected Servers ━━━");
  const servers = await client.callTool({ name: "platform.list_servers", arguments: {} });
  console.log((servers.content as any)[0].text + "\n");

  // 3. Check billing before
  console.log("━━━ TEST 3: Billing Status (before calls) ━━━");
  const billing1 = await client.callTool({ name: "platform.billing_status", arguments: {} });
  console.log((billing1.content as any)[0].text + "\n");

  // 4. Call a proxied tool (echo from "everything" server)
  console.log("━━━ TEST 4: Call github.echo (proxied tool) ━━━");
  const echo = await client.callTool({ name: "github.echo", arguments: { message: "Hello from MCP Platform!" } });
  console.log((echo.content as any)[0].text + "\n");

  // 5. Call another proxied tool
  console.log("━━━ TEST 5: Call firecrawl.echo (different server) ━━━");
  const echo2 = await client.callTool({ name: "firecrawl.echo", arguments: { message: "Firecrawl test!" } });
  console.log((echo2.content as any)[0].text + "\n");

  // 6. Check billing after
  console.log("━━━ TEST 6: Billing Status (after calls) ━━━");
  const billing2 = await client.callTool({ name: "platform.billing_status", arguments: {} });
  console.log((billing2.content as any)[0].text + "\n");

  // 7. Usage summary
  console.log("━━━ TEST 7: Usage Summary ━━━");
  const usage = await client.callTool({ name: "platform.usage_summary", arguments: {} });
  console.log((usage.content as any)[0].text + "\n");

  // 8. Add credits
  console.log("━━━ TEST 8: Add $5 Credits ━━━");
  const credits = await client.callTool({ name: "platform.add_credits", arguments: { amount: 5 } });
  console.log((credits.content as any)[0].text + "\n");

  // 9. Final billing
  console.log("━━━ TEST 9: Final Billing ━━━");
  const billing3 = await client.callTool({ name: "platform.billing_status", arguments: {} });
  console.log((billing3.content as any)[0].text + "\n");

  // 10. Resources
  console.log("━━━ TEST 10: Platform Resources ━━━");
  const resources = await client.listResources();
  for (const r of resources.resources) {
    console.log(`  📦 ${r.uri} — ${r.name}`);
  }
  console.log();

  console.log("🎉 Demo complete! All systems operational.");
  await client.close();
  process.exit(0);
}

demo().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
