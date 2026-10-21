// Sprout server: drafts come from your logged-in `claude` / `codex` CLIs (your plan, no API keys).
import { serve } from "bun";
import { homedir, tmpdir } from "node:os";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { Database } from "bun:sqlite";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import index from "./index.html";

const PORT = Number(process.env.PORT ?? 4747);
const DIR = process.env.SPROUT_DIR ?? `${homedir()}/.sprout`;
mkdirSync(DIR, { recursive: true });

// ---------- storage ----------
const db = new Database(`${DIR}/sprout.db`, { create: true, strict: true });
db.run("PRAGMA journal_mode = WAL");
db.run(`CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', rows TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
db.run("CREATE TABLE IF NOT EXISTS unfurls (url TEXT PRIMARY KEY, data TEXT NOT NULL, fetched_at INTEGER NOT NULL)");
db.run("CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL)");

const insertPost = (title: string, rows: unknown[]) => {
  const id = crypto.randomUUID(), now = Date.now();
  db.query("INSERT INTO posts (id, title, rows, created_at, updated_at) VALUES ($id, $title, $rows, $now, $now)")
    .run({ id, title, rows: JSON.stringify(rows), now });
  return { id, title, rows, updated_at: now };
};
const saveSettings = (s: unknown) =>
  db.query("INSERT INTO settings (id, value) VALUES (1, $v) ON CONFLICT (id) DO UPDATE SET value = $v").run({ v: JSON.stringify(s) });

// One-time import of the pre-sqlite single document.
const legacy = `${DIR}/doc.json`;
if (existsSync(legacy) && !db.query("SELECT 1 FROM posts LIMIT 1").get()) {
  const { title = "", rows = [], ...settings } = JSON.parse(readFileSync(legacy, "utf8"));
  db.transaction(() => { insertPost(title, rows); saveSettings(settings); })();
  renameSync(legacy, `${legacy}.imported`);
}

// Trust boundary: the doc body is the only thing we write to disk.
function postBody(b: any) {
  if (typeof b?.title !== "string" || !Array.isArray(b?.rows)) throw new Error("expected { title: string, rows: [] }");
  return { title: b.title, rows: JSON.stringify(b.rows) };
}

function argv(provider: string, model: string, system: string) {
  if (provider === "codex")
    // Note: codex has no token streaming in exec --json; the whole answer lands at once
    return ["codex", "exec", "-", "--json", "--skip-git-repo-check", "--ephemeral", "-s", "read-only",
      "-c", "model_reasoning_effort=low", "-c", "mcp_servers={}", ...(model ? ["-m", model] : [])];
  // Haiku thinks before every draft (~650-950 hidden output tokens for a 50-word paragraph). Nothing in the CLI turns
  // that off (MAX_THINKING_TOKENS=0, CLAUDE_CODE_DISABLE_THINKING, alwaysThinkingEnabled:false all still think);
  // --effort low measured ~20-30% fewer output tokens and ~1.5s faster.
  return ["claude", "-p", "--model", model || "haiku", "--effort", "low", "--tools", "", "--strict-mcp-config", "--setting-sources", "",
    "--no-session-persistence", "--system-prompt", system,
    "--output-format", "stream-json", "--verbose", "--include-partial-messages"];
}

// One line per draft so you can see what each call costs your plan and how much came from cache.
function logUsage(who: string, fresh = 0, cached = 0, written = 0, out = 0) {
  const total = fresh + cached + written;
  console.log(`[${who}] in ${total} tok (${total ? Math.round((100 * cached) / total) : 0}% cached, ${written} cache-write) · out ${out}`);
}

// Pull text out of one stdout JSON line. Returns [text, error].
function parse(line: string): [string, string] {
  let j: any;
  try { j = JSON.parse(line); } catch { return ["", ""]; }
  if (j.type === "stream_event" && j.event?.delta?.type === "text_delta") return [j.event.delta.text, ""];
  if (j.type === "result" && j.usage) logUsage("claude", j.usage.input_tokens, j.usage.cache_read_input_tokens, j.usage.cache_creation_input_tokens, j.usage.output_tokens);
  if (j.type === "turn.completed" && j.usage) logUsage("codex", j.usage.input_tokens - (j.usage.cached_input_tokens ?? 0), j.usage.cached_input_tokens, 0, j.usage.output_tokens);
  if (j.type === "result" && j.is_error) return ["", String(j.result ?? "claude error")];
  if (j.type === "item.completed" && j.item?.type === "agent_message") return [j.item.text, ""];
  if (j.type === "turn.failed" || j.type === "error") return ["", String(j.error?.message ?? j.message ?? "codex error")];
  return ["", ""];
}

function generate(req: Request, body: { provider: string; model: string; system: string; prompt: string }) {
  const codex = body.provider === "codex";
  if (process.env.SPROUT_DEBUG) Bun.write(`${DIR}/last-request.json`, JSON.stringify(body, null, 2));
  const proc = Bun.spawn(argv(body.provider, body.model, body.system), {
    cwd: tmpdir(), stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  proc.stdin.write(codex ? `${body.system}\n\n${body.prompt}` : body.prompt);
  proc.stdin.end();
  req.signal.addEventListener("abort", () => proc.kill());

  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    async start(c) {
      let buf = "", sent = false, err = "";
      for await (const chunk of proc.stdout.pipeThrough(new TextDecoderStream())) {
        buf += chunk;
        for (let i; (i = buf.indexOf("\n")) >= 0; buf = buf.slice(i + 1)) {
          const [t, e] = parse(buf.slice(0, i));
          if (t) { c.enqueue(enc.encode(t)); sent = true; }
          if (e) err = e;
        }
      }
      const code = await proc.exited;
      if (!err && code && !sent && !req.signal.aborted) err = (await new Response(proc.stderr).text()).trim().slice(-400) || `exit ${code}`;
      // \0 marks an error after the 200 is already on the wire
      if (err) c.enqueue(enc.encode(`\0${err}`));
      c.close();
    },
    cancel() { proc.kill(); },
  }), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

// ---------- link previews ----------
export type Unfurl = { url: string; title: string; description?: string; image?: string; site: string; icon?: string };

// Links come from pasted text or model output, so never let them reach this machine or the local network.
function privateIp(ip: string) {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return privateIp(v.slice(7));
    return v === "::1" || v === "::" || /^f[cd]|^fe[89ab]/.test(v);
  }
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
async function assertPublic(u: URL) {
  if (!/^https?:$/.test(u.protocol)) throw new Error("only http(s) links");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^localhost$|\.(?:local|internal|localhost)$/i.test(host)) throw new Error("private host");
  // Note: checks resolved IPs but fetch re-resolves (DNS rebinding window); fine for a local single-user app
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true })).map(a => a.address);
  if (!ips.length || ips.some(privateIp)) throw new Error("private address");
}
const decode = (s: string) => s.replace(/&(amp|quot|#39|apos|lt|gt|#x27|nbsp);/g, (_, e) =>
  ({ amp: "&", quot: '"', "#39": "'", apos: "'", lt: "<", gt: ">", "#x27": "'", nbsp: " " })[e as string]!).trim();
function metaTag(html: string, key: string) {
  const tag = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "i"))?.[0];
  const v = tag?.match(/content=(["'])([\s\S]*?)\1/i)?.[2];
  return v ? decode(v) : undefined;
}
async function unfurl(raw: string): Promise<Unfurl> {
  const hit = db.query<{ data: string }, [string, number]>("SELECT data FROM unfurls WHERE url = ? AND fetched_at > ?")
    .get(raw, Date.now() - 7 * 864e5);
  if (hit) return JSON.parse(hit.data);
  let u = new URL(raw), res: Response | undefined;
  for (let hop = 0; hop < 4; hop++) { // follow redirects ourselves so every hop is checked
    await assertPublic(u);
    res = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(5000),
      headers: { "user-agent": "Mozilla/5.0 (compatible; SproutPreview/1.0)", accept: "text/html" } });
    const next = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !next) break;
    u = new URL(next, u);
  }
  if (!res?.ok) throw new Error(`HTTP ${res?.status}`);
  let html = "";
  if ((res.headers.get("content-type") ?? "").includes("html")) {
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    while (html.length < 512_000 && !/<\/head>/i.test(html)) { const { value, done } = await reader.read(); if (done) break; html += value; }
    reader.cancel();
  }
  const abs = (v?: string) => { try { return v ? new URL(v, u).href : undefined; } catch { return undefined; } };
  const icon = html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/i)?.[0].match(/href=(["'])(.*?)\1/i)?.[2];
  const data: Unfurl = {
    url: raw,
    title: (metaTag(html, "og:title") ?? metaTag(html, "twitter:title") ?? decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")) || u.hostname,
    description: (metaTag(html, "og:description") ?? metaTag(html, "description"))?.slice(0, 300),
    image: abs(metaTag(html, "og:image") ?? metaTag(html, "twitter:image")),
    site: metaTag(html, "og:site_name") ?? u.hostname.replace(/^www\./, ""),
    icon: abs(icon ?? "/favicon.ico"),
  };
  db.query("INSERT OR REPLACE INTO unfurls (url, data, fetched_at) VALUES (?, ?, ?)").run(raw, JSON.stringify(data), Date.now());
  return data;
}

// ---------- connections: is each CLI installed and logged in? ----------
// Note: we only read the CLIs' own status; login stays in the CLI (it opens a browser flow).
export type Conn = {
  provider: "claude" | "codex"; installed: boolean; loggedIn: boolean; version?: string;
  method?: string; plan?: boolean; account?: string; fix?: string;
};
async function run(cmd: string[]) {
  const p = Bun.spawn(cmd, { cwd: tmpdir(), stdout: "pipe", stderr: "pipe", timeout: 10_000 });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  await p.exited;
  return { ok: p.exitCode === 0, out: (out + "\n" + err).trim() };
}
async function checkClaude(): Promise<Conn> {
  const c: Conn = { provider: "claude", installed: !!Bun.which("claude"), loggedIn: false };
  if (!c.installed) return { ...c, fix: "curl -fsSL https://claude.ai/install.sh | bash" };
  const [ver, auth] = await Promise.all([run(["claude", "--version"]), run(["claude", "auth", "status"])]);
  c.version = ver.out.split(/\s/)[0];
  try {
    const j = JSON.parse(auth.out.slice(auth.out.indexOf("{")));
    c.loggedIn = !!j.loggedIn;
    if (c.loggedIn) {
      c.plan = j.authMethod === "claude.ai";
      c.method = c.plan ? `Claude ${j.subscriptionType ? j.subscriptionType[0].toUpperCase() + j.subscriptionType.slice(1) : "subscription"}` : "API key, billed per token";
      c.account = j.email;
    }
  } catch { /* unparseable status = treat as logged out */ }
  if (!c.loggedIn) c.fix = "claude auth login";
  return c;
}
async function checkCodex(): Promise<Conn> {
  const c: Conn = { provider: "codex", installed: !!Bun.which("codex"), loggedIn: false };
  if (!c.installed) return { ...c, fix: "npm install -g @openai/codex" };
  const [ver, auth] = await Promise.all([run(["codex", "--version"]), run(["codex", "login", "status"])]);
  c.version = ver.out.split(/\s/).at(-1);
  c.loggedIn = auth.ok && /logged in/i.test(auth.out) && !/not logged in/i.test(auth.out);
  if (c.loggedIn) {
    c.plan = /chatgpt/i.test(auth.out);
    c.method = c.plan ? "ChatGPT plan" : "API key, billed per token";
  } else c.fix = "codex login";
  return c;
}
let conns = Promise.all([checkClaude(), checkCodex()]); // warm at startup

// Spawns CLIs on your account: only same-origin pages may call the API.
const sameOrigin = (req: Request) => {
  const o = req.headers.get("origin");
  return !o || new URL(o).host === new URL(req.url).host;
};
const guard = <R extends Request>(h: (req: R) => Response | Promise<Response>) => (req: R) =>
  sameOrigin(req) ? h(req) : new Response("forbidden", { status: 403 });

const server = serve({
  port: PORT,
  hostname: "127.0.0.1", // never expose beyond localhost
  idleTimeout: 120,
  routes: {
    "/*": index,
    "/api/gen": { POST: guard(async req => generate(req, await req.json())) },
    "/api/posts": {
      GET: guard(() => Response.json(db.query(`SELECT id, title, updated_at,
        (SELECT json_extract(value, '$.text') FROM json_each(rows) WHERE trim(json_extract(value, '$.text')) != '' LIMIT 1) AS first
        FROM posts ORDER BY updated_at DESC`).all())),
      POST: guard(() => Response.json(insertPost("", []))),
    },
    "/api/posts/:id": {
      GET: guard(req => {
        const row = db.query<{ rows: string }, [string]>("SELECT id, title, rows, updated_at FROM posts WHERE id = ?")
          .get(req.params.id);
        return row ? Response.json({ ...row, rows: JSON.parse(row.rows) }) : new Response("not found", { status: 404 });
      }),
      PUT: guard(async req => {
        const updated_at = Date.now();
        const { changes } = db.query("UPDATE posts SET title = $title, rows = $rows, updated_at = $updated_at WHERE id = $id")
          .run({ ...postBody(await req.json()), updated_at, id: req.params.id });
        return changes ? Response.json({ updated_at }) : new Response("not found", { status: 404 });
      }),
      DELETE: guard(req => {
        db.query("DELETE FROM posts WHERE id = ?").run(req.params.id);
        return new Response(null, { status: 204 });
      }),
    },
    "/api/unfurl": {
      GET: guard(async req => {
        const url = new URL(req.url).searchParams.get("url") ?? "";
        try { return Response.json(await unfurl(url)); }
        catch (e) { return Response.json({ error: String((e as Error).message ?? e) }, { status: 422 }); }
      }),
    },
    "/api/connections": {
      GET: guard(async req => {
        if (new URL(req.url).searchParams.has("fresh")) conns = Promise.all([checkClaude(), checkCodex()]);
        return Response.json(await conns);
      }),
    },
    "/api/settings": {
      GET: guard(() => {
        const row = db.query<{ value: string }, []>("SELECT value FROM settings WHERE id = 1").get();
        return Response.json(row ? JSON.parse(row.value) : null);
      }),
      PUT: guard(async req => {
        const s = await req.json();
        if (typeof s !== "object" || !s || Array.isArray(s)) throw new Error("expected settings object");
        saveSettings(s);
        return new Response(null, { status: 204 });
      }),
    },
  },
  error(e) { return new Response(String(e), { status: 400 }); },
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
});
console.log(`sprout → ${server.url}  (db: ${DIR}/sprout.db)`);
