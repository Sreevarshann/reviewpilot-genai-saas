"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, CircleDashed, Download, GitCompare, Loader2, RefreshCw, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, followReview } from "@/lib/api";
import { cn } from "@/lib/cn";
import { atLeast } from "@/lib/session";
import type { Finding, ReviewEvent, Severity } from "@/lib/types";
import { DiffView } from "./DiffView";
import { FindingCard } from "./Findings";
import { SeverityBar, StatusBadge } from "./Reviews";
import { useOrg } from "./Shell";
import { Button, Card, Chip, Empty, ErrorNote, fmtDate, fmtMs, Select, Skeleton } from "./ui";

const STAGES = [
  { id: "parsing", label: "Parse diff" },
  { id: "static_checks", label: "Deterministic checks" },
  { id: "model_analysis", label: "Model analysis" },
  { id: "validation", label: "Ground & validate" },
  { id: "completed", label: "Done" },
];

function useReviewEvents(org: string, id: string, onTerminal: () => void) {
  // events are keyed by review so switching reviews never shows the previous stream
  const [state, setState] = useState<{ id: string; events: ReviewEvent[] }>({ id, events: [] });
  const terminal = useRef(onTerminal);
  useEffect(() => {
    terminal.current = onTerminal;
  });
  useEffect(
    () =>
      followReview(
        org,
        id,
        (e) => setState((s) => {
          const xs = s.id === id ? s.events : [];
          return { id, events: xs.some((x) => x.seq === e.seq) ? xs : [...xs, e].sort((a, b) => a.seq - b.seq) };
        }),
        () => terminal.current(),
      ),
    [org, id],
  );
  return state.id === id ? state.events : [];
}

function Timeline({ events }: { events: ReviewEvent[] }) {
  const failed = events.find((e) => e.stage === "failed");
  const last = (stage: string) => [...events].reverse().find((e) => e.stage === stage);
  const validation = last("validation")?.detail as { accepted?: number; rejected?: number; rejectedReasons?: { title?: string; reason: string; line?: number }[] } | undefined;
  const model = last("model_analysis");
  return (
    <Card className="p-4">
      <ol className="grid gap-3 sm:grid-cols-5" aria-label="Review pipeline progress">
        {STAGES.map((s) => {
          const e = last(s.id);
          const done = e && e.status !== "started";
          const running = e?.status === "started";
          const degraded = e?.status === "degraded";
          return (
            <li key={s.id} className="flex items-start gap-2 text-sm">
              <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full", done ? (degraded ? "bg-copper-soft text-copper" : "bg-ok-soft text-ok") : running ? "bg-sapphire-soft text-sapphire" : "bg-panel-2 text-muted")}>
                {done ? degraded ? <TriangleAlert className="size-3" /> : <Check className="size-3" /> : running ? <Loader2 className="size-3 animate-spin motion-reduce:animate-none" /> : <CircleDashed className="size-3" />}
              </span>
              <div className="min-w-0">
                <div className={cn("font-medium", !e && "text-muted")}>{s.label}</div>
                <div className="text-xs text-muted">{stageDetail(s.id, e)}</div>
              </div>
            </li>
          );
        })}
      </ol>
      {failed && <div className="mt-3"><ErrorNote error={String((failed.detail as { error?: string }).error ?? "Review failed")} /></div>}
      {model?.status === "degraded" && <p className="mt-3 text-xs text-copper">Model analysis unavailable: {String((model.detail as { error?: string }).error)}. Deterministic findings are still reported.</p>}
      {validation?.rejectedReasons && validation.rejectedReasons.length > 0 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-muted hover:text-ink">{validation.rejected} model suggestion{validation.rejected === 1 ? "" : "s"} discarded by grounding checks</summary>
          <ul className="mt-2 space-y-1 pl-4">
            {validation.rejectedReasons.map((r, i) => (
              <li key={i} className="list-disc text-muted"><span className="text-ink">{r.title ?? "Untitled"}</span>{r.line ? ` (line ${r.line})` : ""}: {r.reason}</li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

function stageDetail(stage: string, e?: ReviewEvent) {
  if (!e) return "Waiting";
  if (e.status === "started") return "Running…";
  const d = e.detail as Record<string, unknown>;
  switch (stage) {
    case "parsing": return `${d.files} files · +${d.additions} −${d.deletions}`;
    case "static_checks": return `${d.findings} findings`;
    case "model_analysis": return e.status === "degraded" ? "Degraded" : `${d.suggestions} suggestions`;
    case "validation": return `${d.accepted} kept · ${d.rejected} discarded`;
    case "completed": return `${d.findings ?? ""} findings`.trim();
    default: return e.status;
  }
}

export function ReviewDetail() {
  const { org } = useOrg();
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const router = useRouter();
  const review = useQuery({ queryKey: ["review", org.slug, id], queryFn: () => api.review(org.slug, id) });
  const active = review.data?.status === "QUEUED" || review.data?.status === "RUNNING";
  const findings = useQuery({ queryKey: ["findings", org.slug, id], queryFn: () => api.findings(org.slug, id), enabled: review.data?.status === "COMPLETED" });
  const members = useQuery({ queryKey: ["members", org.slug], queryFn: () => api.members(org.slug) });
  const all = useQuery({ queryKey: ["reviews", org.slug], queryFn: () => api.reviews(org.slug), enabled: !!review.data?.parentReviewId });
  // versions share a root (the first review); compare against the immediately previous one
  const prevId = useMemo(() => {
    const cur = review.data;
    if (!cur?.parentReviewId) return null;
    const root = cur.parentReviewId;
    return all.data?.find((x) => (x.id === root || x.parentReviewId === root) && x.version === cur.version - 1)?.id ?? root;
  }, [review.data, all.data]);
  const events = useReviewEvents(org.slug, id, () => {
    qc.invalidateQueries({ queryKey: ["review", org.slug, id] });
    qc.invalidateQueries({ queryKey: ["findings", org.slug, id] });
    qc.invalidateQueries({ queryKey: ["reviews", org.slug] });
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [sev, setSev] = useState<"" | Severity>("");
  const [state, setState] = useState("OPEN_ALL");
  const [conf, setConf] = useState("");
  const [compare, setCompare] = useState(false);
  const rerun = useMutation({ mutationFn: () => api.rerun(org.slug, id), onSuccess: (r) => (qc.invalidateQueries({ queryKey: ["reviews", org.slug] }), router.push(`/o/${org.slug}/reviews/${r.id}`)) });

  const list = useMemo(
    () => (findings.data ?? []).filter((f) => (!sev || f.severity === sev) && (!conf || f.confidence === conf) && (state === "OPEN_ALL" || f.state === state)),
    [findings.data, sev, conf, state],
  );
  const select = (fid: string) => {
    setSelected(fid);
    const f = findings.data?.find((x) => x.id === fid);
    const file = review.data?.files?.find((x) => x.path === f?.path);
    requestAnimationFrame(() => {
      document.getElementById(`finding-${fid}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      if (file && f) document.getElementById(`L-${file.id}-${f.lineStart}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

  if (review.error) return <ErrorNote error={review.error} onRetry={() => review.refetch()} />;
  if (!review.data) return <div className="space-y-4"><Skeleton className="h-10 w-96" /><Skeleton className="h-24" /><Skeleton className="h-96" /></div>;
  const r = review.data;
  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <div>
        <Link href={`/o/${org.slug}`} className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink"><ArrowLeft className="size-3" />Reviews</Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-semibold">{r.title}</h1>
              <StatusBadge status={r.status} />
              <Chip tone="copper">v{r.version}</Chip>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
              <span>{r.project.name}</span>
              <span>{fmtDate(r.createdAt)}</span>
              {r.model && <span>{r.provider} · {r.model}</span>}
              {r.status === "COMPLETED" && <span>{(r.tokensIn + r.tokensOut).toLocaleString()} tokens</span>}
              <span>{fmtMs(r.durationMs)}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {prevId && <Button size="sm" onClick={() => setCompare((v) => !v)} aria-pressed={compare}><GitCompare className="size-3.5" />Compare with v{r.version - 1}</Button>}
            {r.status === "COMPLETED" && <ExportMenu reviewId={r.id} />}
            {atLeast(org.role, "REVIEWER") && !active && <Button size="sm" variant="primary" onClick={() => rerun.mutate()} disabled={rerun.isPending}><RefreshCw className="size-3.5" />Re-run as v{r.version + 1}</Button>}
          </div>
        </div>
        {rerun.error && <div className="mt-2"><ErrorNote error={rerun.error} /></div>}
      </div>

      <Timeline events={events} />
      {compare && prevId && <CompareCard base={prevId} head={r.id} />}

      {r.status === "FAILED" ? null : !r.files?.length ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-w-0"><DiffView files={r.files} findings={findings.data ?? []} selected={selected} onSelect={select} /></div>
          <aside className="space-y-3 xl:sticky xl:top-4 xl:max-h-[calc(100dvh-2rem)] xl:overflow-y-auto xl:pr-1" aria-label="Findings">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">Findings</h2>
              <SeverityBar by={r.stats.bySeverity} />
            </div>
            {r.status === "COMPLETED" && (
              <div className="flex flex-wrap gap-1.5 text-xs text-muted">
                <Chip tone="sapphire">{r.stats.deterministic ?? 0} from rules</Chip>
                <Chip tone="copper">{r.stats.modelAccepted ?? 0} from model</Chip>
                {(r.stats.modelRejected ?? 0) > 0 && <Chip>{r.stats.modelRejected} model suggestions discarded</Chip>}
              </div>
            )}
            <div className="grid grid-cols-3 gap-1.5">
              <Select aria-label="Severity" value={sev} onChange={(e) => setSev(e.target.value as Severity | "")} className="h-8 text-xs">
                <option value="">All severities</option>
                {["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
              </Select>
              <Select aria-label="Source" value={conf} onChange={(e) => setConf(e.target.value)} className="h-8 text-xs">
                <option value="">Rules + model</option>
                <option value="DETERMINISTIC">Rules only</option>
                <option value="MODEL">Model only</option>
              </Select>
              <Select aria-label="State" value={state} onChange={(e) => setState(e.target.value)} className="h-8 text-xs">
                <option value="OPEN_ALL">Any state</option>
                <option value="OPEN">Open</option>
                <option value="ACCEPTED">Accepted</option>
                <option value="DISMISSED">Dismissed</option>
                <option value="FALSE_POSITIVE">False positive</option>
              </Select>
            </div>
            {active ? (
              <p className="py-6 text-center text-sm text-muted">Findings appear when the pipeline finishes.</p>
            ) : findings.error ? (
              <ErrorNote error={findings.error} />
            ) : !findings.data ? (
              <Skeleton className="h-40" />
            ) : !findings.data.length ? (
              <Empty icon={<Check className="size-5" />} title="No findings">Rules and model found nothing to flag in the added lines.</Empty>
            ) : !list.length ? (
              <p className="py-6 text-center text-sm text-muted">No findings match these filters.</p>
            ) : (
              list.map((f) => <FindingCard key={f.id} f={f} selected={selected === f.id} onSelect={() => (selected === f.id ? setSelected(null) : select(f.id))} members={members.data ?? []} reviewId={r.id} />)
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function ExportMenu({ reviewId }: { reviewId: string }) {
  const { org } = useOrg();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}><Download className="size-3.5" />Export</Button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-line bg-panel p-1 shadow-lg">
          {([["json", "JSON"], ["csv", "CSV"], ["md", "Markdown"], ["sarif", "SARIF 2.1.0"]] as const).map(([f, label]) => (
            <a key={f} href={api.exportUrl(org.slug, reviewId, f)} onClick={() => setOpen(false)} className="block rounded-md px-2.5 py-1.5 text-sm hover:bg-panel-2">{label}</a>
          ))}
        </div>
      )}
    </div>
  );
}

function CompareCard({ base, head }: { base: string; head: string }) {
  const { org } = useOrg();
  // base = previous version, head = this version (route: /reviews/:base/compare/:head)
  const q = useQuery({ queryKey: ["compare", org.slug, base, head], queryFn: () => api.compare(org.slug, base, head) });
  if (q.error) return <ErrorNote error={q.error} />;
  if (!q.data) return <Skeleton className="h-28" />;
  const { introduced, resolved, persisting } = q.data;
  const newer = q.data.head;
  const older = q.data.base;
  const col = (title: string, items: Finding[], tone: "crit" | "ok" | "neutral", icon: React.ReactNode) => (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">{icon}{title} <Chip tone={tone}>{items.length}</Chip></div>
      <ul className="space-y-1 text-xs">
        {items.slice(0, 8).map((f) => <li key={f.id} className="truncate text-muted"><span className="text-ink">{f.title}</span> · {f.path}:{f.lineStart}</li>)}
        {items.length > 8 && <li className="text-muted">+{items.length - 8} more</li>}
      </ul>
    </div>
  );
  return (
    <Card className="grid gap-4 p-4 sm:grid-cols-3">
      {col(`New in v${newer.version}`, introduced, "crit", <TriangleAlert className="size-3.5 text-crit" />)}
      {col(`Resolved since v${older.version}`, resolved, "ok", <Check className="size-3.5 text-ok" />)}
      {col("Still present", persisting, "neutral", <X className="size-3.5 text-muted" />)}
    </Card>
  );
}
