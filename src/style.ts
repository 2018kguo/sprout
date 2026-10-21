// What a human writer would and wouldn't put on the page: the system prompt plus a detector for known LLM tells.
// Sources: Wikipedia "Signs of AI writing" (WikiProject AI Cleanup) and the tropes.fyi catalog of AI writing tropes.

export const SYSTEM = `You turn a writer's rough outline into prose that goes out under their name. Write it the way they would if they had the time: their words and terms, their register (a casual outline gets casual prose), plain sentences of varied length.

Do the writing work: turn the note into sentences a reader can follow and connect it to the line before. Stay strictly inside what they told you. You may explain what their line means and why it follows, in their terms. You may not add things that happened, scenes, sensory details, actions they took, specifics, numbers, names, quotes, plans or promises. If the line doesn't give you enough for more than a sentence or two, write a sentence or two: short and true beats long and invented. If a specific fact is essential, leave one [TK: what's needed].
Cover only your line. The other outline lines get their own paragraphs, so don't explain or preview them.
Keep every link the writer gave as a markdown link on the words it supports, like [Blacksmith](https://blacksmith.sh). Never add a link they didn't give.
End on the last concrete point. No closing moral, summary, quotable line, or reversal like "X wasn't the hard part. Y was."

Avoid what reads as machine-written: em dashes; "it's not X, it's Y" and "not just X but Y"; a question answered right away ("The result? Chaos."); "here's the thing"; "serves as" where "is" works; trailing clauses like ", highlighting its importance"; strings of short fragments for drama; triplets of adjectives; "additionally", "moreover", "notably", "ultimately"; words like delve, pivotal, crucial, landscape, tapestry, quietly, deeply, robust, leverage.`;

// strong: reliably reads as machine-written, worth an automatic rewrite. weak: highlight only (humans do these too).
export type Tell = { name: string; re: RegExp; strong: boolean; fix: string };
const S = (s: string) => `(?<=^|[.!?]["')\\]]?\\s+)${s}`; // at a sentence start
export const TELLS: Tell[] = [
  { name: "em dash", strong: true, re: /—|\s–\s|\w\s?--\s?\w/g,
    fix: "use a period, comma or parentheses instead of a dash" },
  { name: "negative parallelism", strong: true,
    re: new RegExp([
      `\\b(?:it|this|that)(?:'s| is|’s) not (?:just |only |about )?[^.;:!?]{1,60}[,;:.] (?:it|this|that)(?:'s| is|’s)\\b`,
      `\\b(?:isn't|is not|wasn't|was not|aren't|are not) (?:just|only|merely|simply) [^.;!?]{1,60}[,;:.] (?:it|they|this|that)\\b`,
      `\\bnot (?:just|only|merely) [^.;!?]{1,60},? but(?: also)?\\b`,
      S(`Not [^.!?]{1,40}\\. Not [^.!?]{1,40}\\.`),
    ].join("|"), "gi"),
    fix: "state the point directly instead of denying something nobody claimed" },
  { name: "contrast reversal", strong: true,
    re: /\b(?:was|is|were|are)(?: not|n't) [^.!?]{1,40}[.!?] (?:[A-Z]\w*)(?: \w+){0,6} (?:was|is|were|are|did)[.!]/g,
    fix: "drop the 'X wasn't hard. Y was.' reversal; say plainly what happened" },
  { name: "question, instant answer", strong: true, re: new RegExp(S(`(?:\\S+ ){0,4}\\S+\\? (?:\\S+ ){0,4}\\S+[.!]`), "g"),
    fix: "say the answer as a plain statement, no rhetorical setup" },
  { name: "false suspense", strong: true, re: /\bhere(?:'s|’s| is) (?:the|a) (?:thing|kicker|catch|twist|truth|deal|problem)\b|\bthe truth is\b|\bplot twist\b/gi,
    fix: "make the point without announcing it" },
  { name: "signposted ending", strong: true, re: /\b(?:in conclusion|in summary|to sum up|ultimately|at the end of the day|at its core|all in all|in short)\b/gi,
    fix: "end on the last real point; don't summarize or announce the ending" },
  { name: "empty transition", strong: true,
    re: new RegExp(`\\b(?:it(?:'s|’s| is) worth noting|it(?:'s|’s| is) important to note|importantly|notably|interestingly)\\b|${S("(?:Additionally|Moreover|Furthermore)\\b")}`, "gi"),
    fix: "cut the transition and just say the next thing" },
  { name: "significance tail", strong: true,
    re: /, (?:highlighting|underscoring|emphasizing|showcasing|reflecting|symbolizing|ensuring|contributing to|cementing|fostering|paving the way|marking)\b[^.!?]*[.!?]/gi,
    fix: "drop the trailing '-ing' clause that claims importance" },
  { name: "'serves as' for 'is'", strong: true, re: /\b(?:serves|stands|acts|functions) as (?:a|an|the)\b|\bboasts\b/gi,
    fix: "use plain 'is' or 'has'" },
  { name: "teacher voice", strong: true, re: /\blet(?:'s|’s) (?:break (?:this|it) down|unpack|dive|delve|explore)\b|\bthink of it (?:as|like)\b|\bimagine a world\b/gi,
    fix: "talk to the reader as a peer; drop the lesson framing" },
  { name: "challenges brush-off", strong: true, re: /\bdespite (?:these|the|its|their|such) challenges\b/gi,
    fix: "describe the specific problem plainly or leave it out" },
  { name: "invented label", strong: false, re: /\bthe [a-z]+ (?:paradox|trap|fallacy)\b/gi,
    fix: "describe the thing instead of coining a name for it" },
  { name: "staccato fragments", strong: false, re: new RegExp(`(?:${S("(?:\\S+ ){0,2}\\S+[.!?]")}(?: |$)){3,}`, "g"),
    fix: "join the fragments into real sentences" },
  { name: "magic adverb", strong: false, re: /\b(?:quietly|deeply|remarkably|truly|genuinely|fundamentally|incredibly|profoundly|seamlessly)\b/gi,
    fix: "cut the adverb or replace it with a concrete detail" },
  { name: "false range", strong: false, re: /\bfrom [^,.;]{1,30} to [^,.;]{1,30},? (?:to|and) [^,.;]{1,30}/gi,
    fix: "name the actual things instead of a 'from X to Y' sweep" },
  { name: "AI vocabulary", strong: false,
    re: /\b(?:delv\w*|tapestry|testament|landscape|realm|multifaceted|pivotal|crucial|vibrant|intricate\w*|interplay|meticulous\w*|underscor\w*|showcas\w*|garner\w*|bolster\w*|leverag\w*|foster\w*|unlock\w*|elevat\w*|seamless\w*|game-?changer|ever-evolving|fast-paced|navigat(?:e|ing) the|in today's|holistic|synergy|paradigm|robust|streamlin\w*|empower\w*)\b/gi,
    fix: "use a plainer word" },
  { name: "decorative arrow", strong: false, re: /[→⟶⇒]/g, fix: "write it out in words" },
];

export type Hit = { start: number; end: number; name: string; strong: boolean; text: string; fix: string };
export function findTells(t: string, extra: Tell[] = []): Hit[] {
  const hits: Hit[] = [];
  for (const tell of [...extra, ...TELLS])
    for (const m of t.matchAll(tell.re)) if (m[0].trim()) hits.push({ start: m.index, end: m.index + m[0].length, name: tell.name, strong: tell.strong, text: m[0], fix: tell.fix });
  hits.sort((a, b) => a.start - b.start || Number(b.strong) - Number(a.strong));
  return hits.filter((h, i) => !hits.slice(0, i).some(p => h.start < p.end)); // first (strongest) wins on overlap
}

// The writer's own banned phrases count as strong tells. /regex/ entries are regexes.
export function banTells(bans: string[]): Tell[] {
  return bans.map(b => b.trim()).filter(Boolean).flatMap(b => {
    const m = b.match(/^\/(.+)\/$/);
    try {
      return [{ name: `banned: ${b}`, strong: true, fix: `don't use "${b}"`,
        re: new RegExp(m ? m[1]! : b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi") }];
    } catch { return []; }
  });
}

// Rewrite instructions naming each strong tell found, quoting the offending text.
export function rerollNote(hits: Hit[]) {
  return hits.filter(h => h.strong).map(h => `- ${h.name}: "${h.text.trim()}" (${h.fix})`).join("\n");
}

// Mechanical fixes that never need a model call.
export const tidy = (t: string) => t.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim();
