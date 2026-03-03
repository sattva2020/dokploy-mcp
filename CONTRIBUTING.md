# Contributing to @sattva/dokploy-mcp

Thanks for your interest in contributing!

## Prerequisites

- Node.js >= 18
- A Dokploy instance (for testing)

## Setup

```bash
git clone https://github.com/sattva2020/dokploy-mcp.git
cd dokploy-mcp
npm install
npm run build
```

## Development

```bash
npm run dev    # watch mode — recompiles on changes
```

### Testing locally with Claude Code

Add the following to `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "dokploy": {
      "command": "node",
      "args": ["/absolute/path/to/dokploy-mcp/dist/index.js"],
      "env": {
        "DOKPLOY_URL": "https://your-dokploy.example.com",
        "DOKPLOY_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Project Structure

```
src/
├── index.ts          # Entry point — env setup, spec fetch, server start
├── apiClient.ts      # HTTP client with x-api-key auth
├── toolGenerator.ts  # OpenAPI → MCP tools converter
└── utils.ts          # Schema conversion, path helpers, error formatting
```

## Pull Request Guidelines

1. Fork the repo and create your branch from `main`
2. Make sure `npm run build` passes without errors
3. Keep changes focused — one feature or fix per PR
4. Write clear commit messages

## Reporting Issues

Open an issue at [GitHub Issues](https://github.com/sattva2020/dokploy-mcp/issues) with:
- Your Node.js version (`node -v`)
- Your Dokploy version
- Steps to reproduce
- Expected vs actual behavior
- Relevant log output (stderr from the MCP server)
