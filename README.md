# Sprout

A writing canvas where you jot a skeleton and drafts grow beside it. It runs locally and drafts with **your own Claude or ChatGPT plan** through the `claude` and `codex` CLIs: no API keys, no per-token bill.

![Sprout: outline on the left, drafts on the right](docs/screenshot.png)

## What it does

- **Outline on the left, drafts on the right.** Type rough lines. When you pause or move to the next line, Sprout reads the whole outline and drafts the lines that need it, streaming each paragraph in beside its line.
- **It won't make things up.** Title and thesis lines get no paragraph. Thin lines get a hint like *"what went wrong? give me the story"* instead of an invented anecdote. Draft length follows how much you wrote.
- **Keep, toss, refine.** `Tab` keeps a draft (then it's yours to edit). `Esc` tosses it, and tossed drafts steer the next take away from them. `⌘↵` asks for a different take, `⌘K` refines it ("shorter", "more concrete", or your own words).
- **Slop filter.** A ban list (em dashes, "delve", "it's not X, it's Y", …) is highlighted in drafts and sent to the model. Select any phrase in a draft to ban it. Drafts that still slip are rewritten once automatically.
- **Copy anywhere.** Markdown, plain text, rich text (Google Docs, Notion, email), Slack, or an X thread split into 280-character posts. Lines you haven't kept are copied as your own words.
- **Posts.** Multiple posts with search, stored in a local SQLite file.

## Requirements

- [Bun](https://bun.sh) 1.3 or newer
- At least one of:
  - [Claude Code](https://docs.claude.com/en/docs/claude-code) CLI, logged in with a Claude subscription (`claude auth login`)
  - [Codex](https://github.com/openai/codex) CLI, logged in with ChatGPT (`codex login`)

Sprout's settings show whether each CLI is installed and logged in, with the command to fix it if not.

## Run it

```sh
bun install
bun dev        # http://localhost:4747
```

| Key | Action |
| --- | --- |
| `↵` | New line (the line you leave gets drafted) |
| `Tab` | Keep / unkeep the draft |
| `Esc` | Toss the draft |
| `⌘↵` | Another take |
| `⌘K` | Refine |
| `⌥,` `⌥.` | Flip between takes |
| `#` | Start a line with `#` to make it a heading |
| `⌘B` | Toggle the posts sidebar |

Paste a multi-line outline to split it into lines and draft them all at once.

## How it works

- `src/index.ts` is the server. It spawns `claude -p` (Haiku or Sonnet, streamed) or `codex exec` for each draft, and stores posts and settings in SQLite.
- `src/store.ts` holds the drafting logic: the whole-outline pass, takes, the slop filter and saving.
- `src/App.tsx` is the UI, built with [shadcn/ui](https://ui.shadcn.com), Tailwind and React, and bundled by Bun.

**Keeping plan usage down.** Everything stable (rules, voice notes, banned phrases, paragraphs you've kept) goes in the system prompt, which the Claude CLI caches. Only the outline and the current task change between calls. On a 7k-token document, drafting a second line read 77% of its input from cache. Drafts run at low effort. Whitespace-only edits and empty lines never trigger a call. The server logs each call's tokens and cache hit rate.

## Privacy and safety

- Everything runs on your machine. The server binds to `127.0.0.1` only and rejects cross-origin requests, because it runs CLIs on your account.
- Sprout stores no credentials; login lives in each CLI. Your posts and settings are in `~/.sprout/sprout.db`.
- Environment variables: `PORT` (default `4747`), `SPROUT_DIR` (default `~/.sprout`), and `SPROUT_DEBUG=1` to save the last model request to `SPROUT_DIR/last-request.json`.

Using your subscription through the official CLIs is subject to your plan's usage limits and terms.

## Development

```sh
bun test           # format conversions
bun run typecheck
```

## License

MIT
