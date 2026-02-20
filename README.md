<div align="center">

# ⚡ MCP Platform

**One Gateway. One Balance. Full Control.**

Unified authentication, billing, and access management for all your MCP servers.

[![Built at](https://img.shields.io/badge/Built%20at-MCP%20Hackathon%20Berlin%202026-blueviolet)](https://openclawberlin.github.io/mcp-platform/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)

[Landing Page](https://openclawberlin.github.io/mcp-platform/) · [Quick Start](#-quick-start) · [Demo](#-demo-scenario) · [Architecture](#-architecture)

</div>

---

## 🔥 The Problem

Companies adopt AI coding tools (Cursor, Claude, Copilot) and developers connect MCP servers to boost productivity. Each server needs its own API key, registration, and credit card.

| Pain Point | Description |
|-----------|-------------|
| 💳 **Billing chaos** | Each developer manages 5-10 separate subscriptions. No central visibility. |
| 🔓 **Security risk** | API keys scattered across configs. MCP servers from untrusted sources. No audit trail. |
| 🚫 **Zero access control** | Junior dev can call the same expensive tools as a senior. No rate limits. |
| 😱 **Admin nightmare** | IT has no visibility into which tools are used, by whom, or how much they cost. |

## ✅ The Solution

MCP Platform sits between your AI agents and MCP servers as a single proxy gateway:

```
┌─────────────────────────────────────────────┐
│            AI Agents                         │
│    (Cursor, Claude Desktop, Copilot)        │
└──────────────────┬──────────────────────────┘
                   │ Single API Key
         ┌─────────▼──────────┐
         │   MCP Platform      │
         │                     │
         │  🔐 Auth            │
         │  💰 Billing         │
         │  📊 Usage Tracking  │
         │  🛡️ Access Control  │
         │  📋 Audit Log       │
         └──┬──────┬───────┬──┘
            │      │       │
     ┌──────▼┐ ┌───▼──┐ ┌─▼─────┐
     │Firecrawl│ │ Exa  │ │fal.ai │
     │scraping │ │search│ │images │
     └────────┘ └──────┘ └───────┘
```

**Before:** 5 registrations → 5 credit cards → 5 dashboards → 0 control

**After:** 1 gateway → 1 API key → 1 dashboard → full control

## 🚀 Quick Start

```bash
git clone https://github.com/openclawberlin/mcp-platform.git
cd mcp-platform
npm install
```

Create a `.env` file with your API keys:

```bash
cp .env.example .env
# Edit .env with your keys:
# FIRECRAWL_API_KEY=your-key
# EXA_API_KEY=your-key
# FAL_KEY=your-key
```

Build and start:

```bash
npm run build
npm start
```

Open the dashboard: **http://localhost:3000/dashboard**

## 🔌 Connect to Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mcp-platform": {
      "url": "http://localhost:3000/sse",
      "headers": {
        "Authorization": "Bearer mcp-platform-demo-key"
      }
    }
  }
}
```

## 🔌 Connect to Cursor

Add to `.cursor/mcp.json` or `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "mcp-platform": {
      "url": "http://localhost:3000/sse",
      "headers": {
        "Authorization": "Bearer mcp-platform-demo-key"
      }
    }
  }
}
```

## 🎬 Demo Scenario

```
1. "Show my billing status"          → $10.00 balance
2. "Search for AI agents using exa"  → Real results, -$0.03
3. "Scrape emnify.com via firecrawl" → Real content, -$0.05
4. "Generate an image with fal"      → Real image,   -$0.10
5. "Show billing and usage summary"  → $9.82, full breakdown
```

Three different providers, three different task types, one gateway with unified billing.

## ⚙️ Features

### What's Working (MVP)
- ✅ HTTP/SSE proxy gateway aggregating multiple MCP servers
- ✅ Tool namespacing (`firecrawl.scrape`, `exa.web_search`, `fal.generate`)
- ✅ API key authentication (SQLite-backed)
- ✅ Per-tool usage tracking (timestamp, duration, input/output size, success/error)
- ✅ Mock billing with configurable per-tool costs and balance management
- ✅ Real-time admin dashboard with live usage feed
- ✅ 5 built-in platform tools + 3 MCP resources
- ✅ Tested with real APIs: Firecrawl (12 tools), Exa (3 tools), fal.ai (12 tools)
- ✅ Environment variable support for secure key management

### Roadmap
- 🔜 OAuth2/OIDC authentication (SSO for enterprise)
- 🔜 Real payment processing via Stripe
- 🔜 Tool-level RBAC policies (block expensive tools per role)
- 🔜 Multi-tenant support
- 🔜 npm package for easy installation (`npx mcp-platform`)

## 📊 Dashboard

Real-time monitoring at `http://localhost:3000/dashboard`:

- **Stats cards** — Total calls, total spent, active servers, avg response time
- **Connected servers** — Each server with tool chips, color-coded
- **Live usage feed** — Scrolling log of every tool call with timing and cost
- **Calls per server** — Bar chart breakdown

## 🏆 Competitive Landscape

| Feature | Hypr MCP Gateway | sigbit/mcp-auth-proxy | Casdoor | **MCP Platform** |
|---------|:---:|:---:|:---:|:---:|
| OAuth Proxy | ✅ | ✅ | ✅ | ✅ |
| Multi-server aggregation | ❌ | ❌ | ❌ | ✅ |
| Per-tool billing | ❌ | ❌ | ❌ | ✅ |
| Usage analytics | Partial | ❌ | ❌ | ✅ |
| Real-time dashboard | ❌ | ❌ | ✅ | ✅ |
| Tool-level RBAC | ❌ | ❌ | ❌ | 🔜 |
| Open source | Partial | ✅ | ✅ | ✅ |

**Our differentiator:** Existing solutions focus on auth only. MCP Platform is the first to combine multi-server aggregation, per-tool billing, and usage analytics in one open-source gateway.

## 🗂️ Project Structure

```
mcp-platform/
├── src/
│   ├── index.ts              # Express server + MCP + dashboard
│   ├── config.ts             # YAML config loader with env var support
│   ├── proxy/
│   │   ├── manager.ts        # Downstream MCP server connections
│   │   └── aggregator.ts     # Tool discovery and namespacing
│   ├── auth/
│   │   └── api-key.ts        # API key validation middleware
│   ├── tracking/
│   │   ├── usage.ts          # Usage logging and rate limiting
│   │   └── billing.ts        # Mock billing engine
│   ├── db/
│   │   └── sqlite.ts         # SQLite schema and queries
│   └── tools/
│       └── platform-tools.ts # Built-in platform management tools
├── docs/
│   └── index.html            # Landing page / presentation
├── gateway.config.yaml       # Server configuration
├── .env.example              # API key template
├── package.json
└── tsconfig.json
```

## 📡 API Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /health` | No | Health check |
| `GET /sse` | Yes | SSE MCP transport |
| `POST /messages` | Yes | MCP message handler |
| `GET /dashboard` | No | Real-time admin dashboard |
| `GET /api/status` | No | Server status JSON |
| `GET /api/usage` | No | Recent usage log |
| `GET /api/billing` | No | User billing data |
| `GET /api/stats` | No | Aggregated statistics |

## ⚡ Built-in MCP Tools

| Tool | Description |
|------|-------------|
| `platform.usage_summary` | Usage breakdown by server/tool |
| `platform.usage_by_tool` | Detailed per-tool statistics |
| `platform.billing_status` | Current balance and spending |
| `platform.add_credits` | Add mock credits to balance |
| `platform.list_servers` | List connected servers and their tools |

## 📝 Configuration

Edit `gateway.config.yaml` to add/remove servers and adjust pricing:

```yaml
servers:
  my-server:
    command: "npx"
    args: ["-y", "some-mcp-server"]
    env:
      API_KEY: "${MY_API_KEY}"
    pricing:
      default: 0.05
```

---

<div align="center">

**Built with ⚡ at MCP Hackathon Berlin 2026**

[⭐ Star on GitHub](https://github.com/openclawberlin/mcp-platform) · [🌐 Landing Page](https://openclawberlin.github.io/mcp-platform/)

</div>
