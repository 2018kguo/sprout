import type { Conn } from "./index";
export type { Conn };

// All drafting state and logic. Mutable store + version counter; React reads it via useSyncExternalStore.
export type Row = {
  id: string; text: string; variants: string[]; vi: number; accepted: boolean; tossed: string[];
  genFor?: string; skip?: string; skipFor?: string; err?: string; ms?: number; refining?: boolean; tossing?: boolean; keptAt?: number;
};
export type Doc = { title: string; rows: Row[] };
export type Settings = { voice: string; bans: string[]; model: string; reroll: boolean };
export type PostSummary = { id: string; title: string; updated_at: number; first: string | null };
export type Gen = { ctrl: AbortController; text: string; note: string; key: number; t0?: number };

export const DEFAULT_BANS = ["—", "delve", "tapestry", "testament to", "in today's", "fast-paced", "ever-evolving", "navigate the",
  "navigating the", "landscape", "realm", "embark", "journey", "elevate", "seamless", "leverage", "unlock", "game-changer",
  "pivotal", "crucial", "foster", "underscore", "showcase", "vibrant", "moreover", "furthermore", "in conclusion",
  "at the end of the day", "/\\bit'?s not (just )?[^.,;]{1,40}[,;] (it'?s|but)\\b/", "/\\bnot (just|only) [^.]{1,40}, but\\b/"];
export const MODELS = [
  { value: "claude:haiku", label: "Claude Haiku", hint: "fast" },
  { value: "claude:sonnet", label: "Claude Sonnet", hint: "better" },
  { value: "codex:", label: "Codex", hint: "no streaming" },
];
export const CHIPS = ["shorter", "punchier", "more concrete", "plainer", "warmer", "add an example", "cut the last sentence"];
const SYSTEM = `You are a ghostwriter drafting from a writer's rough outline. Write like a sharp human essayist: concrete nouns, specific claims, plain words, varied sentence length. Hard rules: no em dashes; no "it's not X, it's Y"; no triplets of adjectives; no throat-clearing openers or summarizing closers; no rhetorical questions unless the outline asks for one. Never invent specific facts, numbers, names or quotes: write around the gap, or, only when a specific fact is essential, leave one [TK: what's needed].`;
const LENGTH_RULE = "Length follows substance: expand only what the writer gave you. A bare phrase gets one to three plain sentences; a line with details gets a fuller paragraph. Never add anecdotes, examples, events, numbers or names the writer didn't give.";

export const store = {
  doc: null as Doc | null,
  postId: "",
  posts: [] as PostSummary[],
  settings: null as Settings | null,
  conns: null as Conn[] | null,
  connsLoading: false,
  settingsOpen: false,
  gens: new Map<string, Gen>(),
  status: "",
  saved: "" as "" | "saving" | "saved" | "error",
  saveErr: "",
  focus: null as null | { id: string; caret?: number },
  version: 0,
};
const listeners = new Set<() => void>();
export const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
export const getVersion = () => store.version;
export function emit() { store.version++; listeners.forEach(l => l()); }

const d = () => store.doc!;
const S = () => store.settings!;
export const newRow = (text = ""): Row => ({ id: crypto.randomUUID(), text, variants: [], vi: 0, accepted: false, tossed: [] });
export const isHeading = (r: Row) => r.text.trimStart().startsWith("#");
export const cur = (r: Row) => r.variants[r.vi];
let genKey = 0;

// ---------- persistence ----------
// Each save captures its post id + doc at call time, so a debounced write can't land on another post.
let saveT: ReturnType<typeof setTimeout>, pending: null | { id: string; run: () => Promise<void> } = null;
export function save() {
  clearTimeout(saveT);
  store.saved = "saving";
  const id = store.postId, doc = d(), settings = S();
  const run = async () => {
    if (pending?.run === run) pending = null;
    try {
      const res = await Promise.all([
        fetch(`/api/posts/${id}`, { method: "PUT", body: JSON.stringify(doc) }),
        fetch("/api/settings", { method: "PUT", body: JSON.stringify(settings) }),
      ]);
      for (const r of res) if (!r.ok) throw new Error(await r.text());
      if (id === store.postId) store.saved = "saved";
      await refreshPosts();
    } catch (e) { store.saved = "error"; store.saveErr = String(e); emit(); }
  };
  pending = { id, run };
  saveT = setTimeout(run, 400);
}
async function flush() { clearTimeout(saveT); await pending?.run(); }

export async function refreshPosts() {
  store.posts = await (await fetch("/api/posts")).json();
  emit();
}
export async function loadConnections(fresh = false) {
  store.connsLoading = true; emit();
  try { store.conns = await (await fetch(`/api/connections${fresh ? "?fresh" : ""}`)).json(); }
  finally { store.connsLoading = false; emit(); }
}
// Unknown (still checking) counts as connected so nothing flashes disabled on load.
export const connected = (provider: string) =>
  !store.conns || store.conns.some(c => c.provider === provider && c.installed && c.loggedIn);
export function openSettings(open: boolean) { store.settingsOpen = open; emit(); }

export async function load() {
  loadConnections();
  const [settings] = await Promise.all([fetch("/api/settings").then(r => r.json()), refreshPosts()]);
  store.settings = { voice: "", bans: DEFAULT_BANS, model: "claude:haiku", reroll: true, ...(settings ?? {}) };
  const want = location.hash.slice(1);
  if (store.posts.some(p => p.id === want)) await openPost(want);
  else if (store.posts[0]) await openPost(store.posts[0].id);
  else await newPost();
  addEventListener("hashchange", () => { const id = location.hash.slice(1); if (id && id !== store.postId) openPost(id); });
}
export async function openPost(id: string) {
  await flush();
  for (const g of store.gens.values()) g.ctrl.abort(); // drafts in flight belong to the old post
  store.gens.clear();
  const res = await fetch(`/api/posts/${id}`);
  if (!res.ok) return refreshPosts();
  const p = await res.json();
  store.postId = id;
  store.doc = { title: p.title, rows: p.rows.length ? p.rows : [newRow()] };
  store.saved = "";
  store.focus = { id: store.doc.rows.at(-1)!.id };
  if (location.hash.slice(1) !== id) location.hash = id;
  emit();
}
export async function newPost() {
  await flush();
  const p = await (await fetch("/api/posts", { method: "POST" })).json();
  await refreshPosts();
  await openPost(p.id);
}
export async function deletePost(id: string) {
  if (pending?.id === id) { clearTimeout(saveT); pending = null; }
  const res = await fetch(`/api/posts/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
  await refreshPosts();
  if (id !== store.postId) return;
  store.postId = "";
  await (store.posts[0] ? openPost(store.posts[0].id) : newPost());
}

// ---------- slop ----------
function banRes() {
  return S().bans.map(b => b.trim()).filter(Boolean).flatMap(b => {
    const m = b.match(/^\/(.+)\/$/);
    try { return [new RegExp(m ? m[1]! : b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")]; } catch { return []; }
  });
}
export type Mark = [start: number, end: number, kind: "slop" | "tk", text: string];
export function marks(t: string): Mark[] {
  const out: Mark[] = [];
  for (const re of banRes()) for (const m of t.matchAll(re)) if (m[0]) out.push([m.index, m.index + m[0].length, "slop", m[0]]);
  for (const m of t.matchAll(/\[TK[^\]]*\]/g)) out.push([m.index, m.index + m[0].length, "tk", m[0]]);
  out.sort((a, b) => a[0] - b[0]);
  return out.filter((m, i) => !out.slice(0, i).some(p => m[0] < p[1])); // drop overlaps
}
export const slopFound = (t: string) => marks(t).filter(m => m[2] === "slop").map(m => m[3]);

// ---------- prompts ----------
function nearestKept(i: number, dir: number) {
  for (let j = i + dir; j >= 0 && j < d().rows.length; j += dir) {
    const r = d().rows[j]!;
    if (isHeading(r)) return "";
    if (r.accepted && cur(r)) return cur(r)!;
  }
  return "";
}
const bansLine = () => {
  const bans = S().bans.filter(b => b.trim());
  return bans.length ? `\nNever use these words or patterns: ${bans.join(" | ")}\n` : "";
};
function buildPrompt(row: Row, extra: string) {
  const doc = d(), i = doc.rows.indexOf(row);
  const outline = doc.rows.filter(r => r.text.trim()).map(r => (r === row ? "→ " : "  ") + r.text.replace(/\s*\n\s*/g, " ")).join("\n");
  let p = `Piece: ${doc.title || "(untitled)"}\n\nOutline (→ marks the line you are drafting):\n${outline}\n`;
  if (S().voice.trim()) p += `\nWriter's voice notes:\n${S().voice}\n`;
  const prev = nearestKept(i, -1), next = nearestKept(i, 1);
  if (prev) p += `\nFinal paragraph just before this one (continue from it, don't repeat it):\n${prev}\n`;
  if (next) p += `\nFinal paragraph just after this one (lead into it):\n${next}\n`;
  if (row.tossed.length) p += `\nThe writer rejected these drafts for this line. Take a clearly different approach:\n${row.tossed.map(t => "- " + t).join("\n")}\n`;
  return p + bansLine() + extra + `\nWrite only the prose for the → line. ${LENGTH_RULE} No heading, no preamble, no quotes around it.`;
}
// One request reads the whole outline and drafts (or skips) every line that needs it.
function buildPassPrompt(nums: number[]) {
  const doc = d();
  let p = `Piece: ${doc.title || "(untitled)"}\n\nOutline (numbered; indentation means nesting):\n`;
  p += doc.rows.map((r, i) => r.text.trim() ? `${i + 1}. ${r.text.replace(/\s*\n\s*/g, " ")}` : "").filter(Boolean).join("\n") + "\n";
  const kept = doc.rows.map((r, i) => r.accepted && cur(r) ? `[${i + 1}] ${cur(r)}` : "").filter(Boolean);
  if (kept.length) p += `\nParagraphs the writer already kept:\n${kept.join("\n\n")}\n`;
  if (S().voice.trim()) p += `\nWriter's voice notes:\n${S().voice}\n`;
  return p + bansLine() + `
Lines to handle now: ${nums.join(", ")}

Read the whole outline first. The paragraphs must read as one piece: each covers only its own line, picks up from the one before, and never repeats a neighbor.
For each line to handle, output "@@<line number>" on its own line, then EITHER the prose for that line OR "SKIP: <a few words to the writer>".
SKIP when the line is a title, thesis or section label that the lines under it develop ("SKIP: the lines below cover this").
SKIP when writing more than a restatement would mean inventing things; say what's missing ("SKIP: what went wrong? give me the story").
${LENGTH_RULE}
Output nothing outside the @@ blocks.`;
}

// ---------- generation ----------
// ponytail: global cap of 3 concurrent CLI processes; raise if your plan's rate limits allow
let active = 0; const waiting: (() => void)[] = [];
const slot = () => active < 3 ? (active++, Promise.resolve()) : new Promise<void>(r => waiting.push(r));
const release = () => { const w = waiting.shift(); w ? w() : active--; };

async function stream(prompt: string, signal: AbortSignal, onText: (t: string) => void) {
  const [provider, model] = S().model.split(":");
  const res = await fetch("/gen", { method: "POST", signal, body: JSON.stringify({ provider, model, system: SYSTEM, prompt }) });
  if (!res.ok) throw new Error(await res.text());
  let all = "";
  for await (const chunk of res.body!.pipeThrough(new TextDecoderStream())) { all += chunk; onText(all.split("\0")[0]!); }
  const [text, err] = all.split("\0");
  if (err) throw new Error(err);
  return text!;
}

function pushVariant(row: Row, text: string, t0: number) {
  row.variants.push(text); row.variants = row.variants.slice(-8); row.vi = row.variants.length - 1;
  row.ms = Math.round(performance.now() - t0);
}

export async function generate(row: Row, { extra = "", replace = false, note = "" } = {}) {
  store.gens.get(row.id)?.ctrl.abort();
  const st: Gen = { ctrl: new AbortController(), text: "", note, key: ++genKey };
  store.gens.set(row.id, st);
  row.err = ""; row.genFor = row.text; emit();
  await slot();
  try {
    if (st.ctrl.signal.aborted) return;
    st.t0 = performance.now();
    const text = (await stream(buildPrompt(row, extra), st.ctrl.signal, t => { st.text = t; emit(); })).trim();
    if (!text) throw new Error("empty draft");
    if (store.gens.get(row.id) !== st) return;
    store.gens.delete(row.id);
    if (replace && row.variants.length) { row.variants[row.vi] = text; row.ms = Math.round(performance.now() - st.t0); }
    else pushVariant(row, text, st.t0);
    save(); emit();
    const found = slopFound(text);
    if (found.length && S().reroll && !note)
      generate(row, { replace: true, note: "rerolling slop…",
        extra: `\nYour previous attempt:\n${text}\nIt used banned phrases (${[...new Set(found)].join(", ")}). Rewrite it without them.\n` });
  } catch (e: any) {
    if (e.name === "AbortError" || store.gens.get(row.id) !== st) return;
    store.gens.delete(row.id); row.err = String(e.message || e); emit();
    loadConnections(true); // a failed draft is often a logged-out CLI
  } finally { release(); }
}

// The line you're typing waits until you leave it or go idle; unchanged lines are never redrafted.
let passTimers: ReturnType<typeof setTimeout>[] = [], passing = false, passAgain = false;
export function schedulePass() {
  passTimers.forEach(clearTimeout);
  passTimers = [setTimeout(() => pass(false), 1200), setTimeout(() => pass(true), 4000)];
}
const needsDraft = (r: Row) => !isHeading(r) && !!r.text.trim() && !r.accepted && !store.gens.has(r.id) && r.text !== r.genFor;
const focusedRowId = () => document.activeElement?.closest<HTMLElement>("[data-row]")?.dataset.row;

export async function pass(includeFocused: boolean) {
  if (passing) return void (passAgain = true);
  if (!connected(S().model.split(":")[0]!)) return; // the banner already says why
  const focused = focusedRowId();
  const todo = d().rows.filter(r => needsDraft(r) && (includeFocused || r.id !== focused));
  if (!todo.length) return;
  passing = true; store.status = "Reading your outline…"; emit();
  const sent = new Map(todo.map(r => [d().rows.indexOf(r) + 1, { row: r, text: r.text, st: null as Gen | null }]));
  todo.forEach(r => { r.genFor = r.text; r.err = ""; r.skip = ""; });
  let t0 = 0;
  // Route each "@@n" block to its row as it streams in.
  const route = (all: string, done: boolean) => {
    for (const [, n, body] of all.matchAll(/^@@(\d+)[^\n]*\n([\s\S]*?)(?=^@@\d|$(?![\s\S]))/gm)) {
      const s = sent.get(Number(n)); if (!s) continue;
      const { row } = s, t = body!.trim();
      if (row.text !== s.text || (s.st && store.gens.get(row.id) !== s.st)) continue; // edited or tossed mid-pass
      if (!done && /^S(K(I(P)?)?)?$/.test(t)) continue; // might become SKIP: don't flash it
      if (t.startsWith("SKIP")) { row.skip = t.replace(/^SKIP:?\s*/, "") || "needs more to go on"; row.skipFor = row.text; continue; }
      if (!s.st) { s.st = { ctrl: new AbortController(), text: "", note: "", key: ++genKey, t0 }; store.gens.set(row.id, s.st); }
      s.st.text = t;
      if (done && t) { store.gens.delete(row.id); pushVariant(row, t, t0); }
    }
    emit();
  };
  await slot();
  try {
    t0 = performance.now();
    route(await stream(buildPassPrompt([...sent.keys()]), new AbortController().signal, t => route(t, false)), true);
  } catch (e: any) {
    for (const { row } of sent.values()) { if (row.genFor === row.text) row.genFor = undefined; row.err = String(e.message || e); }
    loadConnections(true);
  } finally {
    for (const { row, st } of sent.values()) if (st && store.gens.get(row.id) === st) store.gens.delete(row.id);
    release(); save(); passing = false; store.status = ""; emit();
    if (passAgain) { passAgain = false; schedulePass(); }
  }
}

// ---------- actions ----------
export function setText(row: Row, text: string) { row.text = text; save(); emit(); schedulePass(); }
export function keep(row: Row) {
  if (!cur(row)) return;
  row.accepted = !row.accepted; row.keptAt = Date.now(); save(); emit();
}
export function toss(row: Row) {
  const g = store.gens.get(row.id);
  if (g) { g.ctrl.abort(); store.gens.delete(row.id); return emit(); }
  if (!cur(row) || row.accepted) return;
  row.tossing = true; emit();
  setTimeout(() => {
    row.tossing = false;
    row.tossed = [...row.tossed, cur(row)!].slice(-3); // fed back so the next take goes elsewhere
    row.variants.splice(row.vi, 1);
    row.vi = Math.max(0, Math.min(row.vi, row.variants.length - 1));
    row.genFor = row.text; // don't auto-redraft the skeleton you just tossed
    save(); emit();
  }, 200);
}
export function another(row: Row) {
  if (isHeading(row) || !row.text.trim()) return;
  row.accepted = false;
  const prior = row.variants.slice(-3);
  generate(row, { extra: prior.length ? `\nTakes the writer already has (write a distinctly different one):\n${prior.map(t => "- " + t).join("\n")}\n` : "" });
}
export function refine(row: Row, instr: string) {
  if (!cur(row)) return;
  row.refining = false; row.accepted = false;
  store.focus = { id: row.id };
  generate(row, { extra: `\nCurrent draft:\n${cur(row)}\n\nRevise it: ${instr}. Keep what works.\n` });
}
export function flip(row: Row, dir: number) {
  if (row.variants.length < 2 || row.accepted) return;
  row.vi = (row.vi + dir + row.variants.length) % row.variants.length; save(); emit();
}
export function setRefining(row: Row, on: boolean) {
  row.refining = on && !!cur(row);
  if (!on) store.focus = { id: row.id };
  emit();
}
export function splitRow(row: Row, at: number, end: number) {
  const rows = d().rows, r = newRow(row.text.slice(end));
  row.text = row.text.slice(0, at);
  rows.splice(rows.indexOf(row) + 1, 0, r);
  store.focus = { id: r.id, caret: 0 }; save(); emit(); schedulePass();
}
export function deleteRow(row: Row) {
  const rows = d().rows, i = rows.indexOf(row);
  if (rows.length < 2) return;
  store.gens.get(row.id)?.ctrl.abort(); store.gens.delete(row.id);
  rows.splice(i, 1);
  store.focus = { id: rows[Math.max(0, i - 1)]!.id }; save(); emit();
}
export function moveFocus(row: Row, dir: number) {
  const rows = d().rows, next = rows[rows.indexOf(row) + dir];
  if (next) { store.focus = { id: next.id, caret: dir > 0 ? 0 : undefined }; emit(); }
  return !!next;
}
// Pasting a multi-line outline splits it into rows and drafts them all.
export function pasteLines(row: Row, lines: string[], before: string, after: string) {
  const rows = d().rows;
  row.text = before + lines[0];
  const added = lines.slice(1).map(l => newRow(l));
  added[added.length - 1]!.text += after;
  rows.splice(rows.indexOf(row) + 1, 0, ...added);
  store.focus = { id: added[added.length - 1]!.id }; save(); emit(); schedulePass();
}
export function draftAll() {
  d().rows.forEach(r => { if (!r.variants.length) r.genFor = undefined; });
  pass(true);
}
export function editKept(row: Row, text: string) { row.variants[row.vi] = text; save(); }
export function setDoc(patch: Partial<Doc>) { Object.assign(d(), patch); save(); emit(); }
export function setSettings(patch: Partial<Settings>) { Object.assign(S(), patch); save(); emit(); }
export function ban(phrase: string) { if (!S().bans.includes(phrase)) setSettings({ bans: [...S().bans, phrase] }); }
export function toMarkdown() {
  const doc = d();
  const parts = doc.rows.filter(r => isHeading(r) || (r.accepted && cur(r))).map(r => isHeading(r) ? r.text.trim() : cur(r)!.trim());
  return { md: (doc.title ? `# ${doc.title}\n\n` : "") + parts.join("\n\n"), kept: doc.rows.filter(r => r.accepted).length };
}
