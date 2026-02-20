# MCP Platform

MCP proxy/gateway that sits between AI agents and multiple downstream MCP servers, providing unified auth, usage tracking, and mock billing.

## Architecture

```
AI Agent → MCP Platform (single API key) → downstream MCP servers (GitHub, Firecrawl, etc.)
```

## Quick Start

```bash
npm install
npm run build
npm start
```

The platform starts on port 3000 (configurable in `gateway.config.yaml`). A demo API key `mcp-platform-demo-key` is created automatically.

## Endpoints

- `GET /health` — health check (no auth)
- `GET /sse` — SSE MCP transport (requires `Authorization: Bearer <key>`)
- `POST /messages?sessionId=...` — MCP message endpoint

## Built-in Tools

- `platform.usage_summary` — usage breakdown by server/tool
- `platform.usage_by_tool` — detailed per-tool stats
- `platform.billing_status` — current balance and spending
- `platform.add_credits` — add mock credits
- `platform.list_servers` — list connected servers and tools

## Resources

- `platform://status` — gateway health and uptime
- `platform://users` — registered users
- `platform://audit-log` — recent tool calls

## Configuration

Edit `gateway.config.yaml` to add/remove downstream MCP servers, adjust pricing, rate limits, and default credits.
