import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Check, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, Copy, MoreHorizontal, PlugZap, RefreshCw, RotateCcw, Settings2, Sparkles, SquarePen, Trash2, Wand2, X } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInput, SidebarInset,
  SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar,
} from "@/components/ui/sidebar";
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
  CHIPS, DEFAULT_BANS, MODELS, another, ban, connected, same, cur, loadConnections, openSettings, deletePost, deleteRow, newPost, openPost, draftAll, editKept, emit, flip, getVersion, isHeading, keep,
  marks, moveFocus, pasteLines, refine, setDoc, setRefining, setSettings, setText, splitRow, tellsIn, unfurl, URL_RE, store, subscribe, toPiece, toss,
  type Conn, type PostSummary, type Row,
} from "./store";
import { TELLS } from "./style";
import { FORMATS, html, markdown, plainText, slack, thread, type FormatId } from "./formats";
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
    <SidebarProvider>
      <PostsSidebar />
      <SidebarInset className="min-w-0">
      <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-2.5">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
          <input
            value={doc.title} onChange={e => setDoc({ title: e.target.value })} placeholder="Untitled piece" aria-label="Title"
            className="min-w-0 flex-1 basis-60 bg-transparent text-xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/60"
          />
          <span className="text-xs text-primary">{store.status}</span>
          <WordCount />
          <SaveState />
          <Select value={store.settings!.model} onValueChange={model => setSettings({ model })}>
            <SelectTrigger size="sm" className="w-auto" aria-label="Model"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MODELS.map(m => (
                <SelectItem key={m.value} value={m.value} disabled={!connected(m.value.split(":")[0]!)}>
                  {m.label} <span className="text-muted-foreground">· {connected(m.value.split(":")[0]!) ? m.hint : "not connected"}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={draftAll} title="Draft every line that has no draft yet">
            <Sparkles /> Draft all
          </Button>
          <CopyMenu />
          <SettingsSheet />
        </div>
      </header>

      <ConnectionBanner />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-16">
        {doc.rows.map(r => <RowView key={r.id} row={r} only={doc.rows.length === 1} />)}
      </main>

      <footer className="sticky bottom-0 hidden border-t bg-background/85 py-2 text-center text-xs text-muted-foreground backdrop-blur md:block">
        <Hint k="↵">new line</Hint><Hint k="Tab">keep</Hint><Hint k="Esc">toss</Hint><Hint k="⌘↵">another take</Hint>
        <Hint k="⌘K">refine</Hint><Hint k="⌥ , ⌥ .">flip takes</Hint><Hint k="#">heading</Hint>
        <span>select draft text to ban it</span>
      </footer>
      </SidebarInset>
      <BanButton />
      <Toaster position="bottom-center" />
    </SidebarProvider>
  );
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
async function copy(format: FormatId) {
  const piece = toPiece();
  if (!piece.blocks.length && !piece.title) return toast("Nothing to copy yet");
  if (format === "rich") {
    await navigator.clipboard.write([new ClipboardItem({
      "text/html": new Blob([html(piece)], { type: "text/html" }),
      "text/plain": new Blob([plainText(piece)], { type: "text/plain" }),
    })]);
  } else {
    const text = format === "thread" ? thread(piece).join("\n\n---\n\n")
      : format === "slack" ? slack(piece) : format === "plain" ? plainText(piece) : markdown(piece);
    await navigator.clipboard.writeText(text);
  }
  const label = FORMATS.find(f => f.id === format)!.label;
  const what = [piece.kept && plural(piece.kept, "kept paragraph"), piece.yours && plural(piece.yours, "outline line")].filter(Boolean).join(" + ");
  toast.success(`Copied as ${label}`, {
    description: format === "thread" ? `${plural(thread(piece).length, "post")}, separated by ---. ${what}` : what,
  });
}

function CopyMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm"><Copy /> Copy <ChevronDown className="opacity-60" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Kept drafts, plus your own words for lines you haven't kept
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {FORMATS.map(f => (
          <DropdownMenuItem key={f.id} onSelect={() => copy(f.id).catch(e => toast.error(String(e)))} className="flex-col items-start gap-0">
            <span>{f.label}</span>
            <span className="text-xs text-muted-foreground">{f.hint}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WordCount() {
  const { blocks } = toPiece();
  const words = blocks.reduce((n, b) => n + (b.text.match(/\S+/g)?.length ?? 0), 0);
  if (!words) return null;
  return <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline" title="What Copy would output: kept drafts plus your words for the rest">
    {words} words{words >= 200 ? ` · ${Math.round(words / 230)} min` : ""}
  </span>;
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
      <div className="min-w-0">
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
      <LinkChips text={row.text} />
      </div>
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
    const tells = tellsIn(cur(row)!), strong = tells.filter(h => h.strong).length;
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
        {tells.length > 0 && (
          <Badge variant={strong ? "destructive" : "outline"} title={[...new Set(tells.map(h => h.name))].join(", ")}>
            {strong ? `${strong} AI tell${strong === 1 ? "" : "s"}` : `${tells.length} to check`}
          </Badge>
        )}
        {row.ms ? <span className="tabular-nums">{(row.ms / 1000).toFixed(1)}s</span> : null}
      </Meta>
    </>;
  } else if (row.skip && same(row.skipFor, row.text) && !row.accepted) {
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

// Reads with live links; click (or Enter) to edit the raw text, Esc to go back to the outline line.
function Kept({ row }: { row: Row }) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!editing || !el) return;
    el.textContent = cur(row)!; // uncontrolled so typing keeps the caret
    el.focus();
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
    getSelection()?.removeAllRanges(); getSelection()?.addRange(r);
  }, [editing]);
  const cls = cn(draftCls, "border-transparent text-foreground outline-none focus:border-muted-foreground/40");
  if (!editing) return (
    <div tabIndex={0} aria-label="Kept paragraph, click to edit"
      className={cn(cls, "cursor-text", Date.now() - (row.keptAt ?? 0) < 1000 && "settle")}
      onClick={e => { if (!(e.target as HTMLElement).closest("a") && getSelection()?.isCollapsed) setEditing(true); }}
      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); setEditing(true); } }}>
      <Hl t={cur(row)!} linksOnly />
    </div>
  );
  return (
    <div ref={ref} contentEditable="plaintext-only" spellCheck className={cls}
      onInput={e => editKept(row, e.currentTarget.innerText)}
      onBlur={() => setEditing(false)}
      onKeyDown={e => { if (e.key === "Escape") { store.focus = { id: row.id }; emit(); } }} />
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

function Hl({ t, linksOnly }: { t: string; linksOnly?: boolean }) {
  const out: ReactNode[] = [];
  let at = 0;
  marks(t).filter(m => !linksOnly || m.kind !== "tell").forEach((m, i) => {
    out.push(t.slice(at, m.start), m.kind === "link"
      ? <LinkPreview key={i} url={m.url!} className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary">{m.label}</LinkPreview>
      : <mark key={i} className={m.kind === "tk" ? "tk" : m.strong ? "slop" : "tell"} title={m.name}>{t.slice(m.start, m.end)}</mark>);
    at = m.end;
  });
  out.push(t.slice(at));
  return <>{out}</>;
}

// ---------- link previews ----------
function LinkPreview({ url, className, children }: { url: string; className?: string; children: ReactNode }) {
  const u = store.unfurls.get(url), data = u && !(u instanceof Promise) ? u : null;
  return (
    <HoverCard openDelay={250} onOpenChange={open => { if (open) unfurl(url); }}>
      <HoverCardTrigger asChild>
        <a href={url} target="_blank" rel="noreferrer noopener" className={className} onClick={e => e.stopPropagation()}>{children}</a>
      </HoverCardTrigger>
      <HoverCardContent className="w-80 overflow-hidden p-0">
        {data ? <>
          {data.image && <img src={data.image} alt="" className="aspect-[1.91/1] w-full border-b object-cover"
            onError={e => { e.currentTarget.style.display = "none"; }} />}
          <div className="grid gap-1 p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {data.icon && <img src={data.icon} alt="" className="size-3.5" onError={e => { e.currentTarget.style.display = "none"; }} />}
              <span className="truncate">{data.site}</span>
            </div>
            <div className="line-clamp-2 text-sm font-medium leading-snug">{data.title}</div>
            {data.description && <p className="line-clamp-3 text-xs text-muted-foreground">{data.description}</p>}
          </div>
        </> : <p className="p-3 text-xs text-muted-foreground">{u === null ? "No preview for this link" : "Loading preview…"}</p>}
      </HoverCardContent>
    </HoverCard>
  );
}

// Chips under an outline line for each URL in it. Waits for typing to settle before fetching.
function LinkChips({ text }: { text: string }) {
  const urls = [...new Set(text.match(URL_RE) ?? [])];
  const [ready, setReady] = useState<string[]>([]);
  useEffect(() => {
    const t = setTimeout(() => { urls.forEach(unfurl); setReady(urls); }, 700);
    return () => clearTimeout(t);
  }, [urls.join(" ")]);
  const shown = urls.filter(u => ready.includes(u));
  if (!shown.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 px-2 pt-1 pb-1.5">
      {shown.map(u => {
        const x = store.unfurls.get(u), data = x && !(x instanceof Promise) ? x : null;
        return (
          <LinkPreview key={u} url={u} className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-card px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground">
            {data?.icon && <img src={data.icon} alt="" className="size-3.5 shrink-0" onError={e => { e.currentTarget.style.display = "none"; }} />}
            <span className="truncate">{data?.title ?? new URL(u).hostname.replace(/^www\./, "")}</span>
          </LinkPreview>
        );
      })}
    </div>
  );
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
  const settings = store.settings!;
  const [phrase, setPhrase] = useState("");
  const bans = settings.bans.filter(b => b.trim());
  const add = () => { if (phrase.trim()) { ban(phrase.trim()); setPhrase(""); } };
  return (
    <Sheet open={store.settingsOpen} onOpenChange={openSettings}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Settings"><Settings2 /></Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Writing settings</SheetTitle>
          <SheetDescription>Sent with every draft. Changes save automatically.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-4 pb-8">
          <Connections />
          <Separator />
          <section className="grid gap-2">
            <Label htmlFor="voice">Your voice</Label>
            <Textarea id="voice" rows={6} value={settings.voice} onChange={e => setSettings({ voice: e.target.value })}
              placeholder="Short sentences. Dry humor. Audience: engineers who've been burned before. Paste a paragraph you like." />
            <p className="text-xs text-muted-foreground">How you write and who it's for. A sample paragraph works best.</p>
          </section>
          <Separator />
          <section className="grid gap-3">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="ban">Banned phrases <span className="font-normal text-muted-foreground">({bans.length})</span></Label>
              {bans.length > 0 && <Button variant="link" size="sm" className="h-auto p-0 text-xs text-muted-foreground" onClick={() => setSettings({ bans: DEFAULT_BANS })}>
                Clear all
              </Button>}
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
                  <button aria-label={`Unban ${b}`} onClick={() => setSettings({ bans: settings.bans.filter(x => x !== b) })}
                    className="rounded-sm p-0.5 opacity-60 hover:bg-background hover:opacity-100">
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Your own additions. Highlighted in drafts and sent to the model. You can also select text in any draft to ban it.</p>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">Built-in AI-tell checks ({TELLS.length})</summary>
              <ul className="mt-2 grid gap-1.5">
                {TELLS.map(t => (
                  <li key={t.name}><span className={cn("font-medium", t.strong ? "text-destructive" : "text-foreground")}>{t.name}</span>: {t.fix}</li>
                ))}
              </ul>
              <p className="mt-2">Red ones get an automatic rewrite; the rest are just underlined.</p>
            </details>
          </section>
          <Separator />
          <section className="flex items-start justify-between gap-4">
            <div className="grid gap-1">
              <Label htmlFor="reroll">Auto-rewrite AI tells</Label>
              <p className="text-xs text-muted-foreground">If a draft has a strong AI tell (red) or a banned phrase, rewrite it once automatically.</p>
            </div>
            <Switch id="reroll" checked={settings.reroll} onCheckedChange={reroll => setSettings({ reroll })} />
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------- posts ----------
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const UNITS = [["year", 31536e3], ["month", 2592e3], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]] as const;
function ago(t: number) {
  const s = (t - Date.now()) / 1000;
  for (const [unit, n] of UNITS) if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), unit);
  return "just now";
}
const postLabel = (p: PostSummary) =>
  (p.id === store.postId ? store.doc?.title : p.title)?.trim() || p.first?.trim() || "Untitled";

function PostsSidebar() {
  const [q, setQ] = useState("");
  const [del, setDel] = useState<PostSummary | null>(null);
  const { isMobile, setOpenMobile } = useSidebar();
  const go = (fn: () => Promise<unknown>) => { if (isMobile) setOpenMobile(false); fn().catch(e => toast.error(String(e))); };
  const posts = store.posts.filter(p => postLabel(p).toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center justify-between pl-2">
          <span className="font-semibold tracking-tight">Sprout</span>
          <Button variant="ghost" size="icon-sm" onClick={() => go(newPost)} aria-label="New post" title="New post"><SquarePen /></Button>
        </div>
        <SidebarInput placeholder="Search posts" value={q} onChange={e => setQ(e.target.value)} aria-label="Search posts" />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Posts</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {posts.map(p => (
                <SidebarMenuItem key={p.id}>
                  <SidebarMenuButton isActive={p.id === store.postId} onClick={() => go(() => openPost(p.id))}
                    className="h-auto flex-col items-start gap-0.5 py-2">
                    <span className="w-full truncate">{postLabel(p)}</span>
                    <span className="text-xs text-muted-foreground">{ago(p.updated_at)}</span>
                  </SidebarMenuButton>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <SidebarMenuAction showOnHover aria-label="Post actions"><MoreHorizontal /></SidebarMenuAction>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="right" align="start">
                      <DropdownMenuItem variant="destructive" onSelect={() => setDel(p)}><Trash2 /> Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </SidebarMenuItem>
              ))}
              {!posts.length && <p className="px-2 py-1 text-xs text-muted-foreground">No posts match.</p>}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <AlertDialog open={!!del} onOpenChange={o => { if (!o) setDel(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{del && postLabel(del)}”?</AlertDialogTitle>
            <AlertDialogDescription>This removes the outline and every draft in it. It can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive"
              onClick={() => { const id = del!.id; go(() => deletePost(id)); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sidebar>
  );
}

// ---------- connections ----------
const providerName = (p: string) => (p === "claude" ? "Claude" : "Codex");

function ConnectionBanner() {
  const provider = store.settings!.model.split(":")[0]!;
  if (connected(provider)) return null;
  const alt = MODELS.find(m => connected(m.value.split(":")[0]!));
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-4">
      <Alert>
        <PlugZap />
        <AlertTitle>{providerName(provider)} isn't connected</AlertTitle>
        <AlertDescription>
          <p>Drafts won't run until it is. It takes one command in your terminal.</p>
          <div className="mt-1 flex gap-2">
            <Button size="sm" onClick={() => openSettings(true)}>Set up</Button>
            {alt && <Button size="sm" variant="outline" onClick={() => setSettings({ model: alt.value })}>Use {alt.label} instead</Button>}
          </div>
        </AlertDescription>
      </Alert>
    </div>
  );
}

function Connections() {
  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between">
        <Label>Connections</Label>
        <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={store.connsLoading} onClick={() => loadConnections(true)}>
          <RefreshCw className={cn(store.connsLoading && "animate-spin")} /> Recheck
        </Button>
      </div>
      {store.conns ? store.conns.map(c => <ConnCard key={c.provider} c={c} />)
        : <p className="text-sm text-muted-foreground">Checking…</p>}
      <p className="text-xs text-muted-foreground">
        Sprout runs the claude and codex CLIs on this machine, so drafts use your subscription. Log in through the CLI; Sprout stores no keys.
      </p>
    </section>
  );
}

function ConnCard({ c }: { c: Conn }) {
  const ok = c.installed && c.loggedIn;
  return (
    <div className="grid gap-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{providerName(c.provider)}</span>
        {c.version && <span className="text-xs text-muted-foreground">v{c.version}</span>}
        <span className="flex-1" />
        <Badge variant={ok ? "secondary" : "destructive"}>
          {ok && <CircleCheck />}{ok ? c.method : c.installed ? "Not logged in" : "Not installed"}
        </Badge>
      </div>
      {c.account && <p className="text-xs text-muted-foreground">{c.account}</p>}
      {ok && !c.plan && <p className="text-xs text-amber-600 dark:text-amber-400">Using an API key: drafts bill per token, not your plan.</p>}
      {c.fix && <>
        <div className="flex items-center gap-2 rounded-md bg-muted py-1 pr-1 pl-2.5">
          <code className="flex-1 truncate font-mono text-xs">{c.fix}</code>
          <Button variant="ghost" size="icon-sm" className="size-7" aria-label="Copy command"
            onClick={() => navigator.clipboard.writeText(c.fix!).then(() => toast("Copied. Run it in a terminal, then Recheck."))}>
            <Copy />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Run this in a terminal, then Recheck.</p>
      </>}
    </div>
  );
}
