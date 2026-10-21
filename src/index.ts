// Sprout server: drafts come from your logged-in `claude` / `codex` CLIs (your plan, no API keys).
import { serve } from "bun";
import { homedir, tmpdir } from "node:os";
import { mkdirSync, renameSync } from "node:fs";
import index from "./index.html";

const PORT = Number(process.env.PORT ?? 4747);
const DIR = process.env.SPROUT_DIR ?? `${homedir()}/.sprout`;
const DOC = `${DIR}/doc.json`;
mkdirSync(DIR, { recursive: true });

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
const guard = (h: (req: Request) => Response | Promise<Response>) => (req: Request) =>
  sameOrigin(req) ? h(req) : new Response("forbidden", { status: 403 });

const server = serve({
  port: PORT,
  hostname: "127.0.0.1", // never expose beyond localhost
  idleTimeout: 120,
  routes: {
    "/*": index,
    "/gen": { POST: guard(async req => generate(req, await req.json())) },
    "/doc": {
      GET: guard(async () => {
        const f = Bun.file(DOC);
        return (await f.exists()) ? new Response(f) : Response.json(null);
      }),
      PUT: guard(async req => {
        const text = await req.text();
        JSON.parse(text); // refuse to overwrite the doc with garbage
        await Bun.write(`${DOC}.tmp`, text);
        renameSync(`${DOC}.tmp`, DOC);
        return new Response("ok");
      }),
    },
  },
  error(e) { return new Response(String(e), { status: 400 }); },
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
});
console.log(`sprout → ${server.url}  (doc: ${DOC})`);
