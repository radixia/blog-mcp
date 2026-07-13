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
  /** Override the ISC corpus base URL (local dev/testing). */
  ISC_BASE?: string;
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

/* ---------- ISC-HPC 2026 transcript corpus (Radixia Labs) ----------
   Static corpus published by the website at /labs/isc-2026/: 147 auto-caption
   session transcripts, chunked with a one-cue overlap. Fetched once per
   isolate and cached in memory (~1.9 MB JSON). Search UI for humans:
   https://www.radixia.ai/labs/isc-2026-search */
const ISC_BASE = "https://www.radixia.ai/labs/isc-2026";
const ISC_TOOL_URL = "https://www.radixia.ai/labs/isc-2026-search";

interface IscSession { i: number; day: string; time: string; hall: string; title: string }
interface IscChunk { id: number; s: number; t: string; x: string }
interface IscAgendaBlock {
  title: string; day: string; start: string; end: string; place: string; type: string;
  speakers: { n: string; o: string }[]; talks: { si: number; title: string; time: string }[]; single: boolean;
}

let iscDataPromise: Promise<{ sessions: IscSession[]; chunks: IscChunk[] }> | null = null;
let iscAgendaPromise: Promise<IscAgendaBlock[]> | null = null;

function iscData(base = ISC_BASE) {
  if (!iscDataPromise) {
    iscDataPromise = fetch(`${base}/data.json`).then((r) => {
      if (!r.ok) throw new Error(`ISC corpus fetch failed (${r.status})`);
      return r.json();
    });
    iscDataPromise.catch(() => { iscDataPromise = null; }); // allow retry
  }
  return iscDataPromise;
}
function iscAgenda(base = ISC_BASE) {
  if (!iscAgendaPromise) {
    iscAgendaPromise = fetch(`${base}/agenda.json`).then((r) => {
      if (!r.ok) throw new Error(`ISC agenda fetch failed (${r.status})`);
      return r.json();
    });
    iscAgendaPromise.catch(() => { iscAgendaPromise = null; });
  }
  return iscAgendaPromise;
}

const iscSessionLine = (s: IscSession) =>
  [s.title, [s.day, s.time, s.hall].filter(Boolean).join(" · ") || "paper recording"].join(" — ");

/** Chunks carry a one-cue overlap; trim it when stitching a full transcript. */
function iscTrimOverlap(prev: string, cur: string) {
  const max = Math.min(prev.length, cur.length, 400);
  for (let k = max; k >= 5; k--) {
    if (prev.endsWith(cur.slice(0, k))) return cur.slice(k);
  }
  return cur;
}

const ISC_DISCLAIMER =
  "Transcripts are auto-generated captions: names and technical terms may contain recognition errors — verify quotes against the session recordings. Independent tool, not affiliated with ISC. Timestamps are offsets into each recording. Human-friendly search UI: " +
  ISC_TOOL_URL;

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
    version: "1.1.0",
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
      "search_isc2026_transcripts",
      "Full-text search across 147 auto-generated session transcripts from ISC High Performance 2026 (Hamburg, June 23-25): keynotes, panels, vendor talks, research papers. Returns matching passages with session title, day/time/hall and recording timestamp. Quoted phrases must match exactly.",
      {
        query: z.string().min(2).describe("Search terms; wrap exact phrases in double quotes"),
        limit: z.number().min(1).max(25).default(8).describe("Max passages to return"),
      },
      async ({ query, limit }) => {
        const { sessions, chunks } = await iscData(this.env.ISC_BASE);
        const phrases: string[] = [];
        const rest = query.replace(/"([^"]+)"?/g, (_m, p) => { if (p.trim()) phrases.push(p.trim().toLowerCase()); return " "; });
        const terms = rest.toLowerCase().split(/\s+/).filter(Boolean);
        const scored = chunks
          .map((c) => {
            const hay = c.x.toLowerCase();
            if (phrases.some((p) => !hay.includes(p))) return { c, score: 0 };
            let score = phrases.length * 5;
            for (const t of terms) {
              score += (hay.split(t).length - 1) * 2; // exact matches weigh double
              // prefix match so singular/plural and inflections still hit
              // (e.g. "gigafactory" ~ "gigafactories"), min stem length 5
              if (t.length >= 6) score += hay.split(t.slice(0, Math.max(5, t.length - 3))).length - 1;
            }
            return { c, score };
          })
          .filter((x) => x.score > 0 && (terms.length || phrases.length))
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
        if (!scored.length)
          return { content: [{ type: "text", text: `No transcript passages matched "${query}". ${ISC_DISCLAIMER}` }] };
        const text = scored
          .map(({ c }) => `## ${iscSessionLine(sessions[c.s])} @ ${c.t}\n${c.x}`)
          .join("\n\n---\n\n") + `\n\n(${ISC_DISCLAIMER})`;
        return { content: [{ type: "text", text }] };
      },
    );

    this.server.tool(
      "get_isc2026_session",
      "Read the full auto-generated transcript of one ISC 2026 session by (part of) its title. Use search_isc2026_transcripts or get_isc2026_agenda first to find session titles.",
      {
        title: z.string().min(3).describe("Session title or a distinctive part of it, e.g. 'Opening Keynote' or 'TOP500'"),
      },
      async ({ title }) => {
        const { sessions, chunks } = await iscData(this.env.ISC_BASE);
        const q = title.toLowerCase();
        const s = sessions.find((x) => x.title.toLowerCase() === q) || sessions.find((x) => x.title.toLowerCase().includes(q));
        if (!s) return { content: [{ type: "text", text: `No ISC 2026 session matching "${title}". Try get_isc2026_agenda for the list.` }] };
        const list = chunks.filter((c) => c.s === s.i).sort((a, b) => a.id - b.id);
        const paras: string[] = [];
        for (let i = 0; i < list.length; i++) {
          const raw = i === 0 ? list[i].x : iscTrimOverlap(list[i - 1].x, list[i].x).replace(/^\s+/, "");
          if (raw) paras.push(`[${list[i].t}] ${raw}`);
        }
        const text = `# ${iscSessionLine(s)}\n\n${paras.join("\n\n")}\n\n(${ISC_DISCLAIMER})`;
        return { content: [{ type: "text", text }] };
      },
    );

    this.server.tool(
      "get_isc2026_agenda",
      "The ISC High Performance 2026 program (Hamburg, June 23-25): session blocks with times, halls, types and speakers, plus the recorded research-paper talks. Optionally filter by day.",
      {
        day: z.enum(["Tuesday", "Wednesday", "Thursday"]).optional().describe("Conference day to filter"),
      },
      async ({ day }) => {
        const [agenda, { sessions }] = await Promise.all([iscAgenda(this.env.ISC_BASE), iscData(this.env.ISC_BASE)]);
        const blocks = agenda.filter((b) => !day || b.day === day);
        const lines = blocks.map((b) => {
          const head = `- ${b.start}${b.end ? "–" + b.end : ""} · ${b.day} · ${b.place || "?"} · [${b.type}] ${b.title}`;
          const sp = b.speakers?.length ? `\n  speakers: ${b.speakers.map((x) => x.n + (x.o ? ` (${x.o})` : "")).join(", ")}` : "";
          const talks = !b.single && b.talks?.length ? "\n" + b.talks.map((t) => `    · ${t.time ? t.time + " " : ""}${t.title}`).join("\n") : "";
          return head + sp + talks;
        });
        const papers = !day ? sessions.filter((s) => s.day === "Paper session").map((s) => `- [Research Paper] ${s.title}`) : [];
        const text = [
          lines.join("\n") || "(no blocks for that day)",
          papers.length ? `\n## Recorded research-paper talks\n${papers.join("\n")}` : "",
          `\n(${ISC_DISCLAIMER})`,
        ].join("\n");
        return { content: [{ type: "text", text }] };
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
    "Public, read-only MCP server for the Radixia technical blog (AI, serverless architectures, open source, cloud) and the Radixia Labs ISC-HPC 2026 transcript corpus (147 searchable session transcripts).",
  version: "1.1.0",
  vendor: { name: "Radixia srl", url: "https://www.radixia.ai" },
  endpoints: { streamableHttp: "/mcp", sse: "/sse" },
  capabilities: {
    tools: [
      "list_posts", "search_posts", "get_post", "list_tags", "about_radixia",
      "search_isc2026_transcripts", "get_isc2026_session", "get_isc2026_agenda",
    ],
  },
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
      // Server card follows the MCP registry server.json schema (the older
      // "draft/server-card" schema URL no longer resolves); the tool list
      // rides in the _meta extension point.
      const card =
        url.pathname === "/.well-known/mcp/server-card.json"
          ? {
              $schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
              name: "ai.radixia/blog",
              title: "Radixia Blog MCP",
              description: SERVER_CARD.description,
              version: SERVER_CARD.version,
              websiteUrl: "https://www.radixia.ai",
              repository: { url: "https://github.com/radixia/blog-mcp", source: "github" },
              remotes: [{ type: "streamable-http", url: `${url.origin}/mcp` }],
              _meta: { "ai.radixia/tools": SERVER_CARD.capabilities.tools },
            }
          : SERVER_CARD;
      return new Response(JSON.stringify(card, null, 2), {
        headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
      });
    }
    return new Response(
      `Radixia Blog MCP server\n\nMCP endpoint (Streamable HTTP): ${url.origin}/mcp\nLegacy SSE endpoint: ${url.origin}/sse\nServer card: ${url.origin}/.well-known/mcp.json\n\nTools: list_posts, search_posts, get_post, list_tags, about_radixia,\n       search_isc2026_transcripts, get_isc2026_session, get_isc2026_agenda\nContent sources: https://blog.radixia.ai (Ghost Content API, read-only)\n                 https://www.radixia.ai/labs/isc-2026-search (ISC-HPC 2026 transcript corpus)\n`,
      { headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  },
};
