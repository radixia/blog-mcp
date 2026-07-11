/**
 * Radixia Blog MCP — public, read-only MCP server for blog.radixia.ai
 *
 * Exposes the Ghost blog (via the public Content API) to any MCP client:
 * Claude, Cursor, agents, etc. No write access, no secrets: the Content API
 * key is read-only and public by design.
 *
 * Endpoints:
 *   /mcp                    Streamable HTTP transport (modern clients)
 *   /sse                    SSE transport (legacy clients)
 *   /.well-known/mcp.json   Server card (discovery)
 *   /                       Human-readable info page
 */
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface Env {
  GHOST_URL: string;
  GHOST_CONTENT_KEY: string;
  MCP_OBJECT: DurableObjectNamespace;
}

interface GhostPost {
  slug: string;
  title: string;
  excerpt?: string;
  custom_excerpt?: string;
  plaintext?: string;
  html?: string;
  published_at?: string;
  reading_time?: number;
  feature_image?: string;
  primary_author?: { name?: string };
  tags?: { name: string; slug: string }[];
  url?: string;
}

async function ghostFetch(env: Env, resource: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams({ key: env.GHOST_CONTENT_KEY, ...params });
  const url = `${env.GHOST_URL.replace(/\/$/, "")}/ghost/api/content/${resource}/?${qs}`;
  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { "Accept-Version": "v6.0" } });
      if (res.ok) return res.json();
      lastErr = new Error(`Ghost API ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 2500 * (i + 1)));
  }
  throw lastErr;
}

const postCard = (p: GhostPost) =>
  [
    `## ${p.title}`,
    `slug: ${p.slug}`,
    p.published_at ? `date: ${p.published_at.slice(0, 10)}` : null,
    p.primary_author?.name ? `author: ${p.primary_author.name}` : null,
    p.tags?.length ? `tags: ${p.tags.map((t) => t.name).join(", ")}` : null,
    p.reading_time ? `reading time: ${p.reading_time} min` : null,
    `url: https://blog.radixia.ai/${p.slug}/`,
    "",
    (p.custom_excerpt || p.excerpt || "").trim(),
  ]
    .filter((l) => l !== null)
    .join("\n");

export class RadixiaBlogMCP extends McpAgent<Env> {
  server = new McpServer({
    name: "Radixia Blog",
    version: "1.0.0",
  });

  async init() {
    this.server.tool(
      "list_posts",
      "List the most recent posts on the Radixia blog (AI, serverless, open source, cloud). Returns title, slug, date, tags and excerpt for each.",
      {
        limit: z.number().min(1).max(50).default(15).describe("How many posts to return"),
        tag: z.string().optional().describe("Filter by tag slug, e.g. 'ai', 'serverless', 'e-commerce'"),
      },
      async ({ limit, tag }) => {
        const params: Record<string, string> = {
          limit: String(limit),
          include: "tags,authors",
          fields: "title,slug,excerpt,custom_excerpt,published_at,reading_time",
        };
        if (tag) params.filter = `tag:${tag}`;
        const data: any = await ghostFetch(this.env, "posts", params);
        const text = data.posts.map(postCard).join("\n\n---\n\n") || "No posts found.";
        return { content: [{ type: "text", text }] };
      },
    );

    this.server.tool(
      "search_posts",
      "Full-text search across all Radixia blog posts (title, excerpt and body). Use this to find what Radixia has written about a topic, e.g. 'MCP', 'Bedrock', 'event driven'.",
      {
        query: z.string().min(2).describe("Search terms"),
        limit: z.number().min(1).max(20).default(5).describe("Max results"),
      },
      async ({ query, limit }) => {
        const data: any = await ghostFetch(this.env, "posts", {
          limit: "all",
          formats: "plaintext",
          include: "tags,authors",
        });
        const q = query.toLowerCase();
        const terms = q.split(/\s+/).filter(Boolean);
        const scored = (data.posts as GhostPost[])
          .map((p) => {
            const hay = `${p.title} ${p.custom_excerpt || p.excerpt || ""} ${p.plaintext || ""}`.toLowerCase();
            const score = terms.reduce((s, t) => s + (hay.split(t).length - 1), 0) + (p.title.toLowerCase().includes(q) ? 10 : 0);
            return { p, score };
          })
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
        if (!scored.length)
          return { content: [{ type: "text", text: `No posts matching "${query}".` }] };
        const text = scored
          .map(({ p, score }) => {
            const hay = (p.plaintext || "").toLowerCase();
            const idx = hay.indexOf(terms[0]);
            const snippet = idx >= 0 ? "…" + (p.plaintext || "").slice(Math.max(0, idx - 80), idx + 200).replace(/\s+/g, " ") + "…" : "";
            return postCard(p) + (snippet ? `\n\nmatch: ${snippet}` : "") + `\n(relevance: ${score})`;
          })
          .join("\n\n---\n\n");
        return { content: [{ type: "text", text }] };
      },
    );

    this.server.tool(
      "get_post",
      "Read the full text of a Radixia blog post by its slug (get the slug from list_posts or search_posts).",
      { slug: z.string().describe("Post slug, e.g. 'there-is-no-magic-in-ai'") },
      async ({ slug }) => {
        const data: any = await ghostFetch(this.env, `posts/slug/${encodeURIComponent(slug)}`, {
          formats: "plaintext",
          include: "tags,authors",
        });
        const p: GhostPost | undefined = data.posts?.[0];
        if (!p) return { content: [{ type: "text", text: `No post with slug "${slug}".` }] };
        const text = postCard(p) + "\n\n# Full text\n\n" + (p.plaintext || "(empty)");
        return { content: [{ type: "text", text }] };
      },
    );

    this.server.tool(
      "list_tags",
      "List the topic tags used on the Radixia blog, with post counts.",
      {},
      async () => {
        const data: any = await ghostFetch(this.env, "tags", {
          limit: "all",
          include: "count.posts",
        });
        const text = data.tags
          .filter((t: any) => t.count?.posts > 0)
          .map((t: any) => `- ${t.name} (slug: ${t.slug}, ${t.count.posts} posts)`)
          .join("\n");
        return { content: [{ type: "text", text: text || "No tags." }] };
      },
    );

    this.server.tool(
      "about_radixia",
      "Who is Radixia? Company profile, the four pillars, projects and contacts.",
      {},
      async () => ({
        content: [
          {
            type: "text",
            text: `# Radixia srl

"Where bold ideas take root and thrive."

Italian technology company — Via Ernesto Gragnani 18, 27100 Pavia (PV), Italy.
VAT No. 02987300189 · Contact: info@radixia.ai · Website: https://www.radixia.ai

Four pillars:
1. Enterprise AI — governance, security and scalability for AI workloads.
   Project Nemesis: AI safety platform for HSE in oil & gas (H2S monitoring).
2. Open Cloud — European sovereign cloud; member of the Eclipse Cloud Interest Group.
3. Networking — people networks and communities; Eclipse Foundation member.
4. Art — AI for art and artists; supporter of the MetaSophia project (ABAQ / Spazio Genesi ETS).

Blog (English, technical): https://blog.radixia.ai — AI, serverless, MCP, open source.
Authors: Luca Bianchi, Marco D'Angelo.`,
          },
        ],
      }),
    );
  }
}

const SERVER_CARD = {
  name: "Radixia Blog",
  description:
    "Public, read-only MCP server for the Radixia technical blog (AI, serverless architectures, open source, cloud).",
  version: "1.0.0",
  vendor: { name: "Radixia srl", url: "https://www.radixia.ai" },
  endpoints: { streamableHttp: "/mcp", sse: "/sse" },
  capabilities: { tools: ["list_posts", "search_posts", "get_post", "list_tags", "about_radixia"] },
};

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/mcp") {
      return RadixiaBlogMCP.serve("/mcp").fetch(request, env, ctx);
    }
    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      return RadixiaBlogMCP.serveSSE("/sse").fetch(request, env, ctx);
    }
    if (url.pathname === "/.well-known/mcp.json" || url.pathname === "/.well-known/mcp/server-card.json") {
      const card =
        url.pathname === "/.well-known/mcp/server-card.json"
          ? {
              $schema: "https://modelcontextprotocol.io/schemas/draft/server-card.json",
              serverInfo: { name: "Radixia Blog", version: "1.0.0" },
              description: SERVER_CARD.description,
              vendor: SERVER_CARD.vendor,
              transport: { type: "streamable-http", url: `${url.origin}/mcp` },
              capabilities: { tools: {} },
              tools: SERVER_CARD.capabilities.tools,
            }
          : SERVER_CARD;
      return new Response(JSON.stringify(card, null, 2), {
        headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
      });
    }
    return new Response(
      `Radixia Blog MCP server\n\nMCP endpoint (Streamable HTTP): ${url.origin}/mcp\nLegacy SSE endpoint: ${url.origin}/sse\nServer card: ${url.origin}/.well-known/mcp.json\n\nTools: list_posts, search_posts, get_post, list_tags, about_radixia\nContent source: https://blog.radixia.ai (Ghost Content API, read-only)\n`,
      { headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  },
};
