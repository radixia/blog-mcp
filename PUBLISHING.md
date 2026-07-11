# Publishing the Radixia MCP server — runbook

Goal: get the canonical record into the official MCP Registry under the
`ai.radixia` namespace, then let the directories read from it.

Order matters: registry first, directories second.

---

## 0. Prerequisites (one-time)

1. **Public GitHub repo** — create `github.com/radixia/blog-mcp` and push this
   folder (at least `server.json` + `README.md`; ideally the worker source too).
   Glama auto-indexes public GitHub MCP repos, so this also seeds a directory listing.

2. **Branded endpoint (recommended)** — in the Cloudflare dashboard, add a custom
   domain to the Worker so it answers at `https://mcp.radixia.ai/mcp` instead of
   `radixia-blog-mcp.radixa.workers.dev`. More professional and stable.
   - If you skip this, change the `url` in `server.json` back to the workers.dev URL.
   - Note: the namespace is verified on `radixia.ai` regardless of the endpoint host.

3. **Sanity check** — validate the live server with MCP Inspector:
   `npx @modelcontextprotocol/inspector` → connect to the endpoint → confirm the 5 tools.

---

## 1. Official MCP Registry

Install the publisher CLI (see https://modelcontextprotocol.io/registry/quickstart
for the current install command), then from this folder:

```bash
mcp-publisher init          # regenerates server.json with the correct $schema — merge our fields in
mcp-publisher login         # choose DNS auth for the ai.radixia (domain) namespace
```

`login` will give you a **DNS TXT challenge**. Add it in Cloudflare DNS:

```
Type: TXT
Name: radixia.ai        (or the exact host the CLI prints)
Value: <the challenge string from mcp-publisher>
```

Wait for propagation, then:

```bash
mcp-publisher publish
```

Verify it's live:

```bash
curl "https://registry.modelcontextprotocol.io/v0/servers?search=ai.radixia/blog"
```

---

## 2. Directories (after the registry record exists)

Four is the right number in 2026:

- **Smithery** — `smithery mcp publish https://mcp.radixia.ai/mcp -n radixia/blog`
- **Glama** — auto-indexes the public GitHub repo; then claim the listing at glama.ai.
- **PulseMCP** — use the "Submit" button at pulsemcp.com.
- **awesome-mcp-servers** — open a PR against `github.com/punkpeye/awesome-mcp-servers`.
  (Optional 5th: submit at mcp.so.)

Most large directories crawl on their own, so part of this is *claiming* listings
that already exist rather than creating them.

---

## 3. Keep it in sync

When you add tools or bump the version, update `server.json` and re-run
`mcp-publisher publish`. You can wire this into the same deploy step as the Worker.

> CLI flags evolve — check the current quickstart docs if a command differs.
