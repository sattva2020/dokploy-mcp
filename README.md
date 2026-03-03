# @sattva/dokploy-mcp

[![npm version](https://img.shields.io/npm/v/@sattva/dokploy-mcp.svg)](https://www.npmjs.com/package/@sattva/dokploy-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![MCP Compatible](https://img.shields.io/badge/MCP-compatible-blue.svg)](https://modelcontextprotocol.io/)

**MCP server for [Dokploy](https://dokploy.com)** — dynamically generates 420+ tools from the Dokploy OpenAPI spec. Deploy, manage, and monitor your self-hosted infrastructure through AI assistants.

## Why This Package?

| Feature | @sattva/dokploy-mcp | Community alternatives |
|---|---|---|
| **Auth method** | `x-api-key` header (correct) | Often missing or incorrect |
| **API coverage** | 420+ tools (full OpenAPI) | Manual subset (~30-50 tools) |
| **Dependencies** | 2 (`@modelcontextprotocol/sdk`, `zod`) | Often pulls in OpenAI SDK, axios, etc. |
| **Update strategy** | Auto-generates from live spec | Manual maintenance required |
| **Safety annotations** | `readOnlyHint` / `destructiveHint` | Usually missing |
| **Package size** | ~25 KB (dist only) | Varies |

## Key Features

- **Dynamic OpenAPI discovery** — fetches the spec from your Dokploy instance at startup, so new API endpoints are available immediately after a Dokploy upgrade
- **420+ tools** — every Dokploy API endpoint becomes an MCP tool automatically
- **Correct `x-api-key` authentication** — uses the proper header that Dokploy expects
- **Zod input validation** — OpenAPI schemas are converted to Zod for runtime type checking
- **Safety annotations** — read-only operations are marked with `readOnlyHint`, destructive ones with `destructiveHint`
- **Zero-config updates** — upgrade Dokploy, restart the MCP server, get new tools
- **Minimal dependencies** — only `@modelcontextprotocol/sdk` and `zod`

## Quick Start

### Claude Code (CLI)

```bash
claude mcp add --transport stdio \
  --env DOKPLOY_URL=https://dokploy.example.com \
  --env DOKPLOY_API_KEY=your-api-key-here \
  dokploy -- npx -y @sattva/dokploy-mcp@latest
```

### Manual configuration

Add the following to your MCP client config file:

```json
{
  "mcpServers": {
    "dokploy": {
      "command": "npx",
      "args": ["-y", "@sattva/dokploy-mcp@latest"],
      "env": {
        "DOKPLOY_URL": "https://dokploy.example.com",
        "DOKPLOY_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

| Client | Config file |
|---|---|
| **Claude Code** | `~/.claude/mcp.json` |
| **Claude Desktop** | `claude_desktop_config.json` |
| **Cursor** | `.cursor/mcp.json` |
| **Windsurf** | `~/.windsurf/mcp.json` |

### Run directly from the command line

```bash
DOKPLOY_URL=https://dokploy.example.com \
DOKPLOY_API_KEY=your-api-key-here \
npx @sattva/dokploy-mcp@latest
```

## Configuration

| Variable | Required | Description |
|---|---|---|
| `DOKPLOY_URL` | Yes | Base URL of your Dokploy instance (e.g. `https://dokploy.example.com`). **Do not** append `/api` — the server adds it automatically. |
| `DOKPLOY_API_KEY` | Yes | API key for authentication |

### Getting Your API Key

1. Log in to your Dokploy dashboard
2. Go to **Settings** → **Profile**
3. Under **API / Tokens**, click **Generate Token**
4. Copy the generated key

## Tool Naming Convention

OpenAPI paths are converted to tool names:

| OpenAPI Path | Tool Name |
|---|---|
| `/api/application.one` | `application_one` |
| `/api/project.all` | `project_all` |
| `/api/server.create` | `server_create` |
| `/api/docker.getContainers` | `docker_getContainers` |
| `/api/domain.update` | `domain_update` |

## Tool Categories

The tools are organized by Dokploy's API structure:

| Category | Examples | Description |
|---|---|---|
| **Application** | `application_one`, `application_create`, `application_deploy` | Manage applications |
| **Project** | `project_all`, `project_create`, `project_one` | Manage projects |
| **Server** | `server_all`, `server_create`, `server_one` | Manage servers |
| **Docker** | `docker_getContainers`, `docker_getConfig` | Docker operations |
| **Domain** | `domain_create`, `domain_update`, `domain_all` | Domain management |
| **Deployment** | `deployment_all`, `deployment_allByApplication` | Deployment history |
| **Database** | `mysql_*`, `postgres_*`, `mariadb_*`, `mongo_*`, `redis_*` | Database services |
| **Compose** | `compose_*` | Docker Compose services |
| **Registry** | `registry_all`, `registry_create`, `registry_one` | Container registries |
| **Certificate** | `certificates_*` | SSL certificates |
| **User** | `user_all`, `user_one`, `user_update` | User management |
| **Settings** | `settings_*` | Instance settings |

## Safety Annotations

Every tool is annotated based on its HTTP method and operation:

- **`readOnlyHint: true`** — GET requests (safe to call, no side effects)
- **`destructiveHint: true`** — operations that deploy, delete, stop, restart, or otherwise modify state

This helps AI assistants make safer decisions about which tools to call without confirmation.

## Troubleshooting

### `DOKPLOY_URL` must not end with `/api`

The MCP server appends `/api` to the base URL automatically. If you set `DOKPLOY_URL=https://dokploy.example.com/api`, requests will go to `/api/api/...` and fail.

**Correct:** `https://dokploy.example.com`
**Wrong:** `https://dokploy.example.com/api`

### Windows: `npx` does not pass environment variables

On Windows, `npx` launched via `cmd /c` may not forward `env` variables correctly. Use `node` with the full path to `dist/index.js` instead:

```json
{
  "mcpServers": {
    "dokploy": {
      "command": "node",
      "args": ["C:\\Users\\<you>\\AppData\\Roaming\\npm\\node_modules\\@sattva\\dokploy-mcp\\dist\\index.js"],
      "env": {
        "DOKPLOY_URL": "https://dokploy.example.com",
        "DOKPLOY_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

To find the path after a global install:

```bash
npm install -g @sattva/dokploy-mcp
npm root -g
# → C:\Users\<you>\AppData\Roaming\npm\node_modules
```

### Connection refused / timeout

- Verify `DOKPLOY_URL` is reachable: `curl https://dokploy.example.com/api/settings.getOpenApiDocument -H "x-api-key: YOUR_KEY"`
- Check that port 443 (or your custom port) is open
- Ensure the API key is valid and has not been revoked

### 0 tools registered

If the server starts but registers 0 tools, the OpenAPI spec may be empty or in an unexpected format. Check your Dokploy version — the OpenAPI endpoint was introduced in Dokploy v0.9+.

## Development

```bash
git clone https://github.com/sattva2020/dokploy-mcp.git
cd dokploy-mcp
npm install
npm run build
```

### Test locally

```bash
# Watch mode
npm run dev

# Point your MCP client to the local build:
```

```json
{
  "mcpServers": {
    "dokploy": {
      "command": "node",
      "args": ["/path/to/dokploy-mcp/dist/index.js"],
      "env": {
        "DOKPLOY_URL": "https://dokploy.example.com",
        "DOKPLOY_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Architecture

```
┌────────────────┐     ┌──────────────┐     ┌──────────────────┐
│  MCP Client    │────▶│  MCP Server  │────▶│  Dokploy API     │
│  (Claude, etc) │◀────│  (this pkg)  │◀────│  (your instance) │
└────────────────┘     └──────────────┘     └──────────────────┘
       stdio            At startup:
                        1. Fetch OpenAPI spec
                        2. Parse paths → tools
                        3. Build Zod schemas
                        4. Register with MCP SDK
```

**Pipeline:**

1. **Startup** — reads `DOKPLOY_URL` and `DOKPLOY_API_KEY` from environment
2. **Spec fetch** — calls `GET /api/settings.getOpenApiDocument` on the Dokploy instance
3. **Tool generation** — iterates over every path+method in the OpenAPI spec, builds Zod input schemas from parameters and request bodies
4. **Registration** — registers each tool with the MCP SDK, including descriptions and safety annotations
5. **Runtime** — when a tool is called, the server makes the corresponding HTTP request to Dokploy with `x-api-key` auth and returns the JSON response

## License

[MIT](LICENSE) — Copyright (c) 2025-2026 Sattva
