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
- search_isc2026_transcripts — full-text search across 147 auto-caption session transcripts from ISC High Performance 2026 (query, limit)
- get_isc2026_session — full transcript of one ISC 2026 session by title
- get_isc2026_agenda — the ISC 2026 program with times, halls and speakers (day)

The ISC corpus is the static dataset published by the website at
https://www.radixia.ai/labs/isc-2026-search (Radixia Labs). Override its base
URL with the ISC_BASE env var for local testing (see .dev.vars).

See PUBLISHING.md for how this server is published to the official MCP Registry.
