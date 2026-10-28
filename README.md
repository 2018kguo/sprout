<h1 align="center">Sprout</h1>
<p align="center">Write the outline. Grow a draft beside it. Keep the parts you like.</p>
<p align="center">
  <a href="#run-it">Get started</a> ·
  <a href="#writing-with-sprout">How to use it</a> ·
  <a href="#your-data-and-model-account">Your data</a> ·
  <a href="#development">Development</a>
</p>

Sprout is a local writing canvas for turning rough notes into prose. Your
outline stays on the left; suggested paragraphs appear on the right. Keep,
edit or discard each one without losing the notes it came from.

Drafts use your signed-in Claude Code or Codex CLI. Sprout needs no separate
API key; your CLI account's usage limits and billing apply.

![Typing an outline, reviewing drafts, previewing a link and copying to Slack](docs/demo.gif)

<sub>Real time apart from two trimmed pauses. [Full-quality recording](docs/demo.mp4).</sub>

## Run it

Install [Bun](https://bun.sh) and sign in to either
[Claude Code](https://code.claude.com/docs/en/overview) or
[Codex](https://github.com/openai/codex), then:

```sh
git clone https://github.com/2018kguo/sprout.git
cd sprout
bun install
bun dev
```

Open **http://localhost:4747**. Settings checks whether each CLI is installed
and signed in, and shows how to fix either problem.

## Writing with Sprout

Type a few rough lines or paste an outline. When you pause or move to the
next line, Sprout uses the whole outline to draft the lines that need it.
It asks for missing details instead of filling thin notes with invented
stories. Review the suggestions: the model can still add things you did
not mean.

- **Keep, discard, refine.** Accept a paragraph, ask for another take, or
  give an instruction such as “shorter.” Discarded takes steer the next one.
- **Write in your voice.** Add voice notes and banned phrases. Built-in
  style checks rewrite strong matches once and underline weaker ones.
- **Keep links nearby.** Pasted URLs get preview chips and remain available
  to the draft. Hover a link to see its preview.
- **Copy into other tools.** Export Markdown, plain text, rich text, Slack
  formatting or an X thread. Unaccepted lines use your original notes.
- **Keep several posts.** Posts are searchable and saved locally in SQLite.

| Key | Action |
|---|---|
| `↵` | New line; draft the line you leave |
| `Tab` | Keep or unkeep a draft |
| `Esc` | Discard a draft; Undo is available in the toast |
| `⌘↵` | Ask for another take |
| `⌘K` | Refine |
| `⌥,` / `⌥.` | Switch takes |
| `#` at the start of a line | Make a heading |
| `⌘B` | Toggle the posts sidebar |

## Your data and model account

The editor, server and database run on your machine. Draft requests go to
your CLI's model provider, and link previews fetch the pages you paste.
Sprout stores no login credentials; each CLI manages its own authentication.

The server binds to loopback and rejects cross-origin requests. It is built
for one local user. Posts and settings live in `~/.sprout/sprout.db`.

| Setting | Purpose |
|---|---|
| `PORT` | Server port; defaults to `4747` |
| `SPROUT_DIR` | Data directory; defaults to `~/.sprout` |
| `SPROUT_DEBUG=1` | Save the last model request in the data directory for inspection |

## Development

```sh
bun test
bun run typecheck
```

The server and CLI adapters are in [src/index.ts](src/index.ts), drafting
and takes in [src/store.ts](src/store.ts), and style rules in
[src/style.ts](src/style.ts). The UI is React, Tailwind and shadcn/ui,
bundled by Bun.

The optional `bun scripts/tell-eval.ts 3 --judge` runs real drafts through
the app's prompts and checks style and invented details. It uses your model
account. Ordinary tests use local fixtures.

## License

MIT.
