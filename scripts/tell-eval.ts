// Draft a fixed set of outline lines with the app's real prompts and count AI tells.
//   bun scripts/tell-eval.ts [runs=2] [model=haiku] [--judge] > out.json   (summary on stderr)
// Uses your claude CLI login, so each run costs plan usage: 9 lines x runs drafts (x2 with --judge).
// --judge asks a second model call per draft for what the regexes can't see: invented material, mere restatement,
// and the ending. --from=out.json re-judges saved drafts instead of drafting (fair before/after on a new judge).
import { buildPrompt, newRow, store, systemPrompt, type Row } from "../src/store";
import { findTells } from "../src/style";

const args = process.argv.slice(2).filter(a => !a.startsWith("--")), from = process.argv.find(a => a.startsWith("--from="))?.slice(7);
const judge = !!from || process.argv.includes("--judge");
const runs = Number(args[0] ?? 2), model = args[1] ?? "haiku";
const DOCS: { title: string; lines: string[] }[] = [
  { title: "What I learned as a founding engineer", lines: [
    "simplicity matters more than cleverness when 3 people maintain everything",
    "get the foundations right: schema was guessed in week 1, cost us a week in month 6",
    "CI costs add up with agents; blacksmith is cheaper per run but the bill still climbs",
  ] },
  { title: "Offline mode is out", lines: [
    "we shipped offline mode today for ios and android",
    "sync conflicts resolve last-write-wins for now, real merging later",
    "ask: tell us where it breaks, reply to this email",
  ] },
  { title: "First winter in Chicago", lines: [
    "moved here in january knowing nobody",
    "walked a lot because the apartment was too quiet",
    "the guy at the bakery on my block started saving me a loaf",
  ] },
];

const JUDGE = `You audit ghostwritten paragraphs drafted from a writer's outline line. Reply with only JSON:
{"invented": [new material the writer never gave: events, scenes, sensory details, specifics, numbers, names, quotes, promises or commitments, quoted briefly. Do NOT count paraphrase, restating the line in other words, or spelling out what the line plainly implies.],
 "restatement": true if the draft adds essentially nothing beyond the line's own words (it reads like the note, not prose),
 "ending": "plain" | "aphorism" (aphorism = closes on a quotable moral, summary, or "X wasn't A. Y was." reversal),
 "other_lines": true if it covers material that belongs to a different outline line}`;
async function audit(doc: string, lines: string[], line: string, text: string) {
  const out = await draft(JUDGE, `Title: ${doc}\nFull outline:\n${lines.map(l => "- " + l).join("\n")}\n\nLine being drafted: ${line}\n\nDraft:\n${text}`);
  try { return JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)) as { invented: string[]; restatement: boolean; ending: string; other_lines: boolean }; }
  catch { return null; }
}

async function draft(system: string, prompt: string) {
  const p = Bun.spawn(["claude", "-p", "--model", model, "--effort", "low", "--tools", "", "--strict-mcp-config", "--setting-sources", "",
    "--no-session-persistence", "--system-prompt", system, "--output-format", "json"], { stdin: new Blob([prompt]), stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout).text();
  return String(JSON.parse(out).result ?? "").trim();
}

store.settings = { voice: "", bans: [], model: `claude:${model}`, reroll: false };
const jobs: { doc: string; lines: string[]; line: string; system: string; prompt: string }[] = [];
for (const doc of DOCS) {
  const rows: Row[] = doc.lines.map(l => newRow(l));
  store.doc = { title: doc.title, rows };
  for (const row of rows) for (let i = 0; i < runs; i++) jobs.push({ doc: doc.title, lines: doc.lines, line: row.text, system: systemPrompt(), prompt: buildPrompt(row, "") });
}

type Result = { doc: string; line: string; text: string; tells: { name: string; strong: boolean; text: string }[]; audit?: Awaited<ReturnType<typeof audit>> };
const results: Result[] = [];
const saved: Result[] | null = from ? await Bun.file(from).json() : null;
if (saved) for (let i = 0; i < saved.length; i += 3)
  results.push(...await Promise.all(saved.slice(i, i + 3).map(async r => ({
    ...r, audit: await audit(r.doc, DOCS.find(d => d.title === r.doc)!.lines, r.line, r.text),
  }))));
else for (let i = 0; i < jobs.length; i += 3) // 3 at a time, like the app
  results.push(...await Promise.all(jobs.slice(i, i + 3).map(async j => {
    const text = await draft(j.system, j.prompt);
    const tells = findTells(text).map(({ name, strong, text }) => ({ name, strong, text }));
    return { doc: j.doc, line: j.line, text, tells, audit: judge ? await audit(j.doc, j.lines, j.line, text) : undefined };
  })));

const words = results.reduce((n, r) => n + r.text.split(/\s+/).length, 0);
const strong = results.flatMap(r => r.tells.filter(t => t.strong)), all = results.flatMap(r => r.tells);
const byName: Record<string, number> = {};
for (const t of all) byName[t.name] = (byName[t.name] ?? 0) + 1;
console.error(`${results.length} drafts, ${words} words, ${Math.round(words / results.length)} words/draft`);
console.error(`strong tells: ${strong.length} (${((100 * strong.length) / words).toFixed(2)}/100 words), drafts with any strong tell: ${results.filter(r => r.tells.some(t => t.strong)).length}/${results.length}`);
console.error(`all tells: ${all.length}`, byName);
if (judge) {
  const a = results.map(r => r.audit).filter(Boolean) as NonNullable<Result["audit"]>[];
  console.error(`judge (${a.length} audited): invented details ${a.reduce((n, x) => n + x.invented.length, 0)} total, drafts with any ${a.filter(x => x.invented.length).length}/${a.length}; aphorism endings ${a.filter(x => x.ending === "aphorism").length}/${a.length}; covers other lines ${a.filter(x => x.other_lines).length}/${a.length}; mere restatement ${a.filter(x => x.restatement).length}/${a.length}`);
}
console.log(JSON.stringify(results, null, 2));
