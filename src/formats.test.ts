import { expect, test } from "bun:test";
import { html, markdown, slack, thread, type Piece } from "./formats";

const piece: Piece = {
  title: "Founding eng",
  blocks: [
    { kind: "h", level: 1, text: "Lessons" },
    { kind: "p", text: "Keep it **simple** and *boring*. See [the post](https://x.com/a)." },
  ],
};

test("markdown demotes headings under the title", () => {
  expect(markdown(piece)).toBe("# Founding eng\n\n## Lessons\n\nKeep it **simple** and *boring*. See [the post](https://x.com/a).");
});

test("slack converts bold, italic and links without italics eating bold", () => {
  expect(slack(piece)).toBe("*Founding eng*\n\n*Lessons*\n\nKeep it *simple* and _boring_. See <https://x.com/a|the post>.");
});

test("html escapes text and keeps markup", () => {
  expect(html({ title: "", blocks: [{ kind: "p", text: "a < b **c**\nd" }] })).toBe("<p>a &lt; b <strong>c</strong><br>d</p>");
});

test("thread posts never exceed 280 chars and are numbered", () => {
  const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} says something moderately long here.`).join(" ");
  const posts = thread({ title: "T", blocks: [{ kind: "p", text: long }, { kind: "p", text: "x".repeat(700) }] });
  expect(posts.length).toBeGreaterThan(3);
  for (const p of posts) expect(p.length).toBeLessThanOrEqual(280);
  expect(posts[0]!.endsWith(` 1/${posts.length}`)).toBe(true);
  expect(thread({ title: "", blocks: [{ kind: "p", text: "short" }] })).toEqual(["short"]);
});
