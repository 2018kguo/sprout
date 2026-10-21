import { expect, test } from "bun:test";
import { banTells, findTells, tidy } from "./style";

const names = (t: string) => findTells(t).map(h => h.name);

test.each([
  ["It's not a bug, it's a feature.", "negative parallelism"],
  ["The meeting isn't just a ritual; it is a crutch.", "negative parallelism"],
  ["This is not only faster but also cheaper.", "negative parallelism"],
  ["Not a bug. Not a feature. A design flaw.", "negative parallelism"],
  ["We shipped it. The result? Chaos.", "question, instant answer"],
  ["Here's the thing about standups.", "false suspense"],
  ["Ultimately, the team moved on.", "signposted ending"],
  ["It's worth noting that nobody asked.", "empty transition"],
  ["We tried it. Additionally, we measured it.", "empty transition"],
  ["The team moved to async updates, highlighting its commitment to focus.", "significance tail"],
  ["The doc serves as a record of the week.", "'serves as' for 'is'"],
  ["Let's break this down.", "teacher voice"],
  ["Despite these challenges, the team thrived.", "challenges brush-off"],
  ["We hit the supervision paradox.", "invented label"],
  ["He left. Then silence. Nothing.", "staccato fragments"],
  ["The fix quietly worked.", "magic adverb"],
  ["It touched everything from hiring to onboarding to payroll.", "false range"],
  ["A pivotal moment for the team.", "AI vocabulary"],
  ["We were fast — too fast.", "em dash"],
  ["The schema change itself was not hard. The week it cost us was.", "contrast reversal"],
])("flags %p as %p", (text, name) => {
  expect(names(text)).toContain(name);
});

test.each([
  "There were four of us, and we sat close enough to hear each other's keyboards.",
  "By 9:30 every morning, everyone already knew what everyone else was working on.",
  "I didn't want a meeting, so I wrote a doc and asked people to read it by ten.",
  "Is it slower? Sometimes, when someone forgets to update the doc for a few days in a row.",
  "We went from three repos to one, and builds got faster.",
  "The bill was not small, but it was predictable.",
])("leaves plain human prose alone: %p", text => {
  expect(findTells(text).filter(h => h.strong)).toEqual([]);
});

test("writer bans are strong tells and regex bans work", () => {
  const hits = findTells("We used synergies and the word utilize.", banTells(["utilize", "/synerg\\w+/"]));
  expect(hits.map(h => h.name)).toEqual(["banned: /synerg\\w+/", "banned: utilize"]);
  expect(hits.every(h => h.strong)).toBe(true);
});

test("tidy straightens curly quotes", () => {
  expect(tidy("“Fine,” she said. It’s done.")).toBe('"Fine," she said. It\'s done.');
});
