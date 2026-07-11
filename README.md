# Radixia Blog — MCP server

Public, read-only Model Context Protocol server for the Radixia blog. Runs on Cloudflare Workers (streamable HTTP).

- Endpoint: https://mcp.radixia.ai/mcp
- Registry: ai.radixia/blog

## Tools

- list_posts — recent posts (limit, tag)
- search_posts — full-text search (query, limit)
- get_post — full post by slug
- list_tags — tags with counts
- about_radixia — company profile

See PUBLISHING.md for how this server is published to the official MCP Registry.
