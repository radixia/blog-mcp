# Discovery from your own site (zero-cost, do this too)

You already serve `llms.txt` and `/.well-known/api-catalog`. Make the MCP endpoint
explicit there so agents that read the site find the server directly.

## Add to llms.txt

```
## MCP
Radixia exposes a public, read-only MCP server for its blog:
- Endpoint: https://mcp.radixia.ai/mcp  (streamable HTTP)
- Registry: ai.radixia/blog
- Tools: list_posts, search_posts, get_post, list_tags, about_radixia
```

## Optional: /.well-known/mcp.json

Some agent clients probe for a well-known MCP descriptor. A minimal one:

```json
{
  "servers": [
    { "name": "ai.radixia/blog", "url": "https://mcp.radixia.ai/mcp", "transport": "streamable-http" }
  ]
}
```
