// Sprout server: drafts come from your logged-in `claude` / `codex` CLIs (your plan, no API keys).
import { serve } from "bun";
import { homedir, tmpdir } from "node:os";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { Database } from "bun:sqlite";
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
    // ponytail: codex has no token streaming in exec --json; the whole answer lands at once
    return ["codex", "exec", "-", "--json", "--skip-git-repo-check", "--ephemeral", "-s", "read-only",
      "-c", "model_reasoning_effort=low", "-c", "mcp_servers={}", ...(model ? ["-m", model] : [])];
  return ["claude", "-p", "--model", model || "haiku", "--tools", "", "--strict-mcp-config", "--setting-sources", "",
    "--no-session-persistence", "--system-prompt", system,
    "--output-format", "stream-json", "--verbose", "--include-partial-messages"];
}

// Pull text out of one stdout JSON line. Returns [text, error].
function parse(line: string): [string, string] {
  let j: any;
  try { j = JSON.parse(line); } catch { return ["", ""]; }
  if (j.type === "stream_event" && j.event?.delta?.type === "text_delta") return [j.event.delta.text, ""];
  if (j.type === "result" && j.is_error) return ["", String(j.result ?? "claude error")];
  if (j.type === "item.completed" && j.item?.type === "agent_message") return [j.item.text, ""];
  if (j.type === "turn.failed" || j.type === "error") return ["", String(j.error?.message ?? j.message ?? "codex error")];
  return ["", ""];
}

function generate(req: Request, body: { provider: string; model: string; system: string; prompt: string }) {
  const codex = body.provider === "codex";
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
