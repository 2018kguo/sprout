// Turn a piece into paste-ready text for different destinations.
export type Block = { kind: "h"; level: number; text: string } | { kind: "p"; text: string; yours?: boolean };
export type Piece = { title: string; blocks: Block[] };

type Inline = { b: (s: string) => string; i: (s: string) => string; code: (s: string) => string; link: (text: string, url: string) => string };
// Note: regex inline markdown (bold, italic, code, links); nested/escaped markup isn't handled
function inline(t: string, f: Inline) {
  return t
    .replace(/`([^`]+)`/g, (_, c) => f.code(c))
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, a, u) => f.link(a, u))
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => `\u0001${a ?? b}\u0002`) // park bold so italics can't eat it
    .replace(/(?<![\w*])\*(?=\S)(.+?)(?<=\S)\*(?![\w*])|(?<!\w)_(?=\S)(.+?)(?<=\S)_(?!\w)/g, (_, a, b) => f.i(a ?? b))
    .replace(/\u0001(.*?)\u0002/g, (_, s) => f.b(s));
}
const plainInline: Inline = { b: s => s, i: s => s, code: s => s, link: (t, u) => (t === u ? u : `${t} (${u})`) };
const plain = (t: string) => inline(t, plainInline);
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function markdown(p: Piece) {
  const shift = p.title ? 1 : 0; // the title is the only H1
  return [p.title && `# ${p.title}`, ...p.blocks.map(b =>
    b.kind === "h" ? `${"#".repeat(Math.min(6, b.level + shift))} ${b.text}` : b.text)].filter(Boolean).join("\n\n");
}

export function plainText(p: Piece) {
  return [p.title, ...p.blocks.map(b => plain(b.text))].filter(Boolean).join("\n\n");
}

export function slack(p: Piece) {
  const f: Inline = { b: s => `*${s}*`, i: s => `_${s}_`, code: s => `\`${s}\``, link: (t, u) => `<${u}|${t}>` };
  return [p.title && `*${p.title}*`, ...p.blocks.map(b => (b.kind === "h" ? `*${plain(b.text)}*` : inline(b.text, f)))]
    .filter(Boolean).join("\n\n");
}

// For Google Docs, Notion, email: pasted as real headings and paragraphs.
export function html(p: Piece) {
  const f: Inline = { b: s => `<strong>${s}</strong>`, i: s => `<em>${s}</em>`, code: s => `<code>${s}</code>`, link: (t, u) => `<a href="${u}">${t}</a>` };
  const shift = p.title ? 1 : 0;
  return [p.title && `<h1>${esc(p.title)}</h1>`, ...p.blocks.map(b => b.kind === "h"
    ? `<h${Math.min(6, b.level + shift)}>${inline(esc(b.text), f)}</h${Math.min(6, b.level + shift)}>`
    : `<p>${inline(esc(b.text), f).replace(/\n/g, "<br>")}</p>`)].filter(Boolean).join("\n");
}

// X/Twitter thread: packs paragraphs into posts ≤ max chars, splitting long ones at sentences, then words.
// Note: counts JS chars; X weighs URLs as 23 and CJK as 2, so URL/CJK-heavy posts can run slightly over
export function thread(p: Piece, max = 280) {
  const room = max - 8; // leave space for " 12/34"
  const units = [p.title, ...p.blocks.map(b => plain(b.text))].filter(Boolean).flatMap(u => split(u, room));
  const posts = pack(units, room, "\n\n");
  return posts.length < 2 ? posts : posts.map((t, i) => `${t} ${i + 1}/${posts.length}`);
}
function split(text: string, room: number): string[] {
  if (text.length <= room) return [text];
  const sentences = text.match(/[^.!?]+(?:[.!?]+["')\]]*|$)\s*/g)?.map(s => s.trim()).filter(Boolean) ?? [text];
  if (sentences.length > 1) return pack(sentences.flatMap(s => split(s, room)), room, " ");
  return pack(text.split(/\s+/), room, " ").flatMap(s => (s.length > room ? s.match(new RegExp(`.{1,${room}}`, "g"))! : [s]));
}
function pack(parts: string[], room: number, sep: string) {
  const out: string[] = [];
  for (const s of parts) {
    const last = out.at(-1);
    if (last !== undefined && last.length + sep.length + s.length <= room) out[out.length - 1] = last + sep + s;
    else out.push(s);
  }
  return out;
}

export const FORMATS = [
  { id: "markdown", label: "Markdown", hint: "GitHub, Obsidian, blogs" },
  { id: "plain", label: "Plain text", hint: "LinkedIn, anywhere" },
  { id: "rich", label: "Rich text", hint: "Google Docs, Notion, email" },
  { id: "slack", label: "Slack", hint: "bold and links in Slack syntax" },
  { id: "thread", label: "X thread", hint: "split into 280-char posts" },
] as const;
export type FormatId = (typeof FORMATS)[number]["id"];
