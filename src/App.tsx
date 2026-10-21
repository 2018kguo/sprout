import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, RotateCcw, Settings2, Sparkles, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import {
  CHIPS, DEFAULT_BANS, MODELS, another, ban, cur, deleteRow, draftAll, editKept, emit, flip, getVersion, isHeading, keep,
  marks, moveFocus, pasteLines, refine, setDoc, setRefining, setText, slopFound, splitRow, store, subscribe, toMarkdown, toss,
  type Row,
} from "./store";
import "./index.css";

export function App() {
  const v = useSyncExternalStore(subscribe, getVersion);
  useLayoutEffect(() => {
    const f = store.focus;
    if (!f) return;
    store.focus = null;
    const ta = document.querySelector<HTMLTextAreaElement>(`[data-row="${f.id}"] textarea`);
    if (!ta) return;
    ta.focus();
    const p = f.caret ?? ta.value.length;
    ta.setSelectionRange(p, p);
  }, [v]);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const set = () => document.documentElement.classList.toggle("dark", mq.matches);
    set(); mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, []);
  const doc = store.doc;
  if (!doc) return null;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-2.5">
          <input
            value={doc.title} onChange={e => setDoc({ title: e.target.value })} placeholder="Untitled piece" aria-label="Title"
            className="min-w-0 flex-1 basis-60 bg-transparent text-xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/60"
          />
          <span className="text-xs text-primary">{store.status}</span>
          <SaveState />
          <Select value={doc.model} onValueChange={model => setDoc({ model })}>
            <SelectTrigger size="sm" className="w-auto" aria-label="Model"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MODELS.map(m => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label} <span className="text-muted-foreground">· {m.hint}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={draftAll} title="Draft every line that has no draft yet">
            <Sparkles /> Draft all
          </Button>
          <Button variant="outline" size="sm" onClick={copy} title="Copy kept paragraphs as Markdown">
            <Copy /> Copy
          </Button>
          <SettingsSheet />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-5 pb-32">
        {doc.rows.map(r => <RowView key={r.id} row={r} only={doc.rows.length === 1} />)}
      </main>

      <BanButton />
      <footer className="fixed inset-x-0 bottom-0 hidden border-t bg-background/85 py-2 text-center text-xs text-muted-foreground backdrop-blur md:block">
        <Hint k="↵">new line</Hint><Hint k="Tab">keep</Hint><Hint k="Esc">toss</Hint><Hint k="⌘↵">another take</Hint>
        <Hint k="⌘K">refine</Hint><Hint k="⌥ , ⌥ .">flip takes</Hint><Hint k="#">heading</Hint>
        <span>select draft text to ban it</span>
      </footer>
      <Toaster position="bottom-center" />
    </div>
  );
}

async function copy() {
  const { md, kept } = toMarkdown();
  await navigator.clipboard.writeText(md);
  toast.success(`Copied ${kept} kept paragraph${kept === 1 ? "" : "s"} as Markdown`);
}

function SaveState() {
  if (store.saved === "error") return <Badge variant="destructive" title={store.saveErr}>Not saved</Badge>;
  return <span className="w-12 text-right text-xs text-muted-foreground">{store.saved === "saving" ? "…" : store.saved}</span>;
}

const Hint = ({ k, children }: { k: string; children: ReactNode }) => (
  <span className="mr-3 inline-flex items-center gap-1"><Kbd>{k}</Kbd>{children}</span>
);

// ---------- one outline line + its draft ----------
function RowView({ row, only }: { row: Row; only: boolean }) {
  const heading = isHeading(row);
  return (
    <div data-row={row.id}
      className={cn("group grid gap-x-7 gap-y-1 border-b py-2.5 md:border-0 md:py-1.5", !heading && "md:grid-cols-[minmax(200px,33%)_1fr]")}>
      <textarea
        value={row.text} rows={1} spellCheck={false} aria-label="Outline line"
        placeholder={only ? "Jot a skeleton line… “open on the night the servers died; I was at a wedding”" : ""}
        onChange={e => setText(row, e.target.value)}
        onKeyDown={e => onLineKey(e, row)}
        onPaste={e => onLinePaste(e, row)}
        className={cn(
          "field-sizing-content min-h-8 w-full resize-none rounded-md bg-transparent px-2 py-1.5 font-mono text-[13.5px] leading-normal outline-none",
          "placeholder:text-muted-foreground/60 focus:bg-card focus:ring-1 focus:ring-border",
          heading && "pt-5 font-sans text-lg font-semibold",
        )}
      />
      {!heading && <DraftView row={row} />}
    </div>
  );
}

function onLineKey(e: React.KeyboardEvent<HTMLTextAreaElement>, row: Row) {
  const ta = e.currentTarget, mod = e.metaKey || e.ctrlKey;
  const stop = () => e.preventDefault();
  if (e.key === "Enter" && mod) { stop(); another(row); }
  else if (e.key === "Enter" && !e.shiftKey) { stop(); splitRow(row, ta.selectionStart, ta.selectionEnd); }
  else if (e.key === "Tab") { stop(); keep(row); }
  else if (e.key === "Escape") { stop(); toss(row); }
  else if (mod && e.key.toLowerCase() === "k") { stop(); setRefining(row, true); }
  else if (e.altKey && (e.code === "Comma" || e.code === "Period")) { stop(); flip(row, e.code === "Comma" ? -1 : 1); }
  else if (e.key === "Backspace" && !ta.value) { stop(); deleteRow(row); }
  else if (e.key === "ArrowUp" && ta.selectionEnd === 0) { if (moveFocus(row, -1)) stop(); }
  else if (e.key === "ArrowDown" && ta.selectionStart === ta.value.length) { if (moveFocus(row, 1)) stop(); }
}

function onLinePaste(e: React.ClipboardEvent<HTMLTextAreaElement>, row: Row) {
  const lines = e.clipboardData.getData("text").split(/\r?\n/).map(l => l.replace(/^\s*[-*•]\s+/, "").trimEnd()).filter(l => l.trim());
  if (lines.length < 2) return;
  e.preventDefault();
  const ta = e.currentTarget;
  pasteLines(row, lines, ta.value.slice(0, ta.selectionStart), ta.value.slice(ta.selectionEnd));
}

const draftCls = "font-draft whitespace-pre-wrap break-words border-l-2 px-3 py-1 text-[17px] leading-[1.62]";
const focusLine = (row: Row) => { if (getSelection()?.isCollapsed) { store.focus = { id: row.id }; emit(); } };

function DraftView({ row }: { row: Row }) {
  const g = store.gens.get(row.id);
  let body: ReactNode = null;
  if (g) {
    body = <>
      <div key={g.key} className={cn(draftCls, "pop border-dashed border-primary text-foreground", g.text ? "live" : "wait")}>
        <Hl t={g.text} />
      </div>
      <Meta>{g.note || "Drafting…"}<Act onClick={() => toss(row)} k="esc">Stop</Act></Meta>
    </>;
  } else if (cur(row) && row.accepted) {
    body = <>
      <Kept key={`${row.vi}`} row={row} />
      <Meta>
        <span className="inline-flex items-center gap-1"><Check className="size-3.5" /> Kept</span>
        <Act onClick={() => keep(row)} k="tab">Unkeep</Act>
        <Act onClick={() => another(row)} k="⌘↵">Another take</Act>
      </Meta>
    </>;
  } else if (cur(row)) {
    const slop = slopFound(cur(row)!).length;
    body = <>
      <div onClick={() => focusLine(row)}
        className={cn(draftCls, "cursor-text border-dashed border-border text-muted-foreground group-focus-within:border-primary group-focus-within:text-foreground",
          row.tossing && "toss")}>
        <Hl t={cur(row)!} />
      </div>
      <Meta>
        <Act onClick={() => keep(row)} k="tab"><Check /> Keep</Act>
        <Act onClick={() => toss(row)} k="esc"><X /> Toss</Act>
        <Act onClick={() => another(row)} k="⌘↵"><RotateCcw /> Another</Act>
        <Act onClick={() => setRefining(row, true)} k="⌘K"><Wand2 /> Refine</Act>
        {row.variants.length > 1 && <span className="inline-flex items-center">
          <Button variant="ghost" size="icon-sm" className="size-7" onClick={() => flip(row, -1)} aria-label="Previous take"><ChevronLeft /></Button>
          <span className="tabular-nums">{row.vi + 1}/{row.variants.length}</span>
          <Button variant="ghost" size="icon-sm" className="size-7" onClick={() => flip(row, 1)} aria-label="Next take"><ChevronRight /></Button>
        </span>}
        <span className="flex-1" />
        {slop > 0 && <Badge variant="destructive">{slop} slop</Badge>}
        {row.ms ? <span className="tabular-nums">{(row.ms / 1000).toFixed(1)}s</span> : null}
      </Meta>
    </>;
  } else if (row.skip && row.skipFor === row.text && !row.accepted) {
    body = <Meta subtle><span className="italic">{row.skip}</span><Act onClick={() => another(row)}>Draft anyway</Act></Meta>;
  } else if (row.tossed.length && !row.accepted) {
    body = <Meta>Tossed<Act onClick={() => another(row)} k="⌘↵">Another take</Act></Meta>;
  }
  return (
    <div className="min-w-0 [perspective:700px]">
      {body}
      {row.err && <Meta error>{row.err}<Act onClick={() => another(row)}>Retry</Act></Meta>}
      {row.refining && <Refine row={row} />}
    </div>
  );
}

function Kept({ row }: { row: Row }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current!.textContent = cur(row)!; }, []); // uncontrolled so typing keeps the caret
  return (
    <div ref={ref} contentEditable="plaintext-only" spellCheck
      onInput={e => editKept(row, e.currentTarget.innerText)}
      onKeyDown={e => { if (e.key === "Escape") { store.focus = { id: row.id }; emit(); } }}
      className={cn(draftCls, Date.now() - (row.keptAt ?? 0) < 1000 && "settle", "border-transparent text-foreground outline-none focus:border-muted-foreground/40")} />
  );
}

function Meta({ children, subtle, error }: { children: ReactNode; subtle?: boolean; error?: boolean }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1 px-3 pt-1 text-xs text-muted-foreground transition-opacity",
      error ? "text-destructive" : subtle ? "opacity-70 group-hover:opacity-100 group-focus-within:opacity-100"
        : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100")}>
      {children}
    </div>
  );
}

const Act = ({ onClick, k, children }: { onClick: () => void; k?: string; children: ReactNode }) => (
  <Button variant="ghost" size="sm" onClick={onClick} className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground [&_svg]:size-3.5">
    {children}{k && <Kbd className="ml-0.5 hidden md:inline-flex">{k}</Kbd>}
  </Button>
);

function Refine({ row }: { row: Row }) {
  const [v, setV] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2">
      <Input autoFocus value={v} onChange={e => setV(e.target.value)} placeholder="How should it change? ↵" aria-label="Refine instruction"
        className="h-8 min-w-48 flex-1"
        onKeyDown={e => {
          if (e.key === "Enter" && v.trim()) { e.preventDefault(); refine(row, v.trim()); }
          if (e.key === "Escape") setRefining(row, false);
        }} />
      {CHIPS.map(c => (
        <Button key={c} variant="outline" size="sm" className="h-7 rounded-full px-3 text-xs" onClick={() => refine(row, c)}>{c}</Button>
      ))}
    </div>
  );
}

function Hl({ t }: { t: string }) {
  const out: ReactNode[] = [];
  let at = 0;
  marks(t).forEach(([s, e, kind], i) => {
    out.push(t.slice(at, s), <mark key={i} className={kind}>{t.slice(s, e)}</mark>);
    at = e;
  });
  out.push(t.slice(at));
  return <>{out}</>;
}

// ---------- select draft text → ban it ----------
function BanButton() {
  const [sel, setSel] = useState<null | { x: number; y: number; t: string }>(null);
  useEffect(() => {
    const onUp = () => setTimeout(() => {
      const s = getSelection(), t = s?.toString().trim() ?? "";
      if (!s || !t || t.length > 60 || !s.anchorNode?.parentElement?.closest(".font-draft")) return setSel(null);
      const r = s.getRangeAt(0).getBoundingClientRect();
      setSel({ x: r.left, y: r.bottom + 6, t });
    });
    const hide = () => setSel(null);
    document.addEventListener("mouseup", onUp);
    addEventListener("scroll", hide, true);
    return () => { document.removeEventListener("mouseup", onUp); removeEventListener("scroll", hide, true); };
  }, []);
  if (!sel) return null;
  return (
    <Button size="sm" className="fixed z-20 h-7 text-xs shadow-md" style={{ left: sel.x, top: sel.y }}
      onMouseDown={e => e.preventDefault()}
      onClick={() => { ban(sel.t); getSelection()?.removeAllRanges(); setSel(null); toast("Banned. Future drafts avoid it."); }}>
      Ban “{sel.t.length > 24 ? sel.t.slice(0, 24) + "…" : sel.t}”
    </Button>
  );
}

// ---------- settings ----------
function SettingsSheet() {
  const doc = store.doc!;
  const [phrase, setPhrase] = useState("");
  const bans = doc.bans.filter(b => b.trim());
  const add = () => { if (phrase.trim()) { ban(phrase.trim()); setPhrase(""); } };
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Settings"><Settings2 /></Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Writing settings</SheetTitle>
          <SheetDescription>Sent with every draft. Changes save automatically.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-4 pb-8">
          <section className="grid gap-2">
            <Label htmlFor="voice">Your voice</Label>
            <Textarea id="voice" rows={6} value={doc.voice} onChange={e => setDoc({ voice: e.target.value })}
              placeholder="Short sentences. Dry humor. Audience: engineers who've been burned before. Paste a paragraph you like." />
            <p className="text-xs text-muted-foreground">How you write and who it's for. A sample paragraph works best.</p>
          </section>
          <Separator />
          <section className="grid gap-3">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="ban">Banned phrases <span className="font-normal text-muted-foreground">({bans.length})</span></Label>
              <Button variant="link" size="sm" className="h-auto p-0 text-xs text-muted-foreground" onClick={() => setDoc({ bans: DEFAULT_BANS })}>
                Reset to defaults
              </Button>
            </div>
            <div className="flex gap-2">
              <Input id="ban" value={phrase} onChange={e => setPhrase(e.target.value)} placeholder="Add a phrase, or /regex/"
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
              <Button variant="secondary" onClick={add}>Add</Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {bans.map(b => (
                <Badge key={b} variant="secondary" className="gap-1 pr-1 font-normal">
                  <span className={cn(b.startsWith("/") && "font-mono text-[11px]")}>{b}</span>
                  <button aria-label={`Unban ${b}`} onClick={() => setDoc({ bans: doc.bans.filter(x => x !== b) })}
                    className="rounded-sm p-0.5 opacity-60 hover:bg-background hover:opacity-100">
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Highlighted in drafts and sent to the model. You can also select text in any draft to ban it.</p>
          </section>
          <Separator />
          <section className="flex items-start justify-between gap-4">
            <div className="grid gap-1">
              <Label htmlFor="reroll">Auto-reroll slop</Label>
              <p className="text-xs text-muted-foreground">If a draft uses a banned phrase, rewrite it once automatically.</p>
            </div>
            <Switch id="reroll" checked={doc.reroll} onCheckedChange={reroll => setDoc({ reroll })} />
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
