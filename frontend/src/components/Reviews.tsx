"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleDashed, FileDiff, Loader2, Plus, XCircle } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { atLeast } from "@/lib/session";
import type { Review, Severity } from "@/lib/types";
import { useOrg } from "./Shell";
import { Button, Card, Chip, Empty, ErrorNote, fmtMs, Input, Meter, PageHeader, relTime, Select, SEVERITY_TONE, Skeleton } from "./ui";

export function StatusBadge({ status }: { status: Review["status"] }) {
  const m = {
    QUEUED: { icon: CircleDashed, tone: "neutral", label: "Queued" },
    RUNNING: { icon: Loader2, tone: "sapphire", label: "Running" },
    COMPLETED: { icon: CheckCircle2, tone: "ok", label: "Completed" },
    FAILED: { icon: XCircle, tone: "crit", label: "Failed" },
  }[status] as { icon: typeof CircleDashed; tone: "neutral" | "sapphire" | "ok" | "crit"; label: string };
  return (
    <Chip tone={m.tone}>
      <m.icon className={`size-3 ${status === "RUNNING" ? "animate-spin motion-reduce:animate-none" : ""}`} />
      {m.label}
    </Chip>
  );
}

const SEV: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
export function SeverityBar({ by }: { by?: Partial<Record<Severity, number>> }) {
  if (!by) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {SEV.filter((s) => (by[s] ?? 0) > 0).map((s) => (
        <Chip key={s} tone={SEVERITY_TONE[s]} title={`${by[s]} ${s.toLowerCase()}`}>
          {by[s]} {s[0] + s.slice(1).toLowerCase()}
        </Chip>
      ))}
    </div>
  );
}

export function ReviewsDashboard() {
  const { org } = useOrg();
  const reviews = useQuery({ queryKey: ["reviews", org.slug], queryFn: () => api.reviews(org.slug), refetchInterval: (q) => (q.state.data?.some((r) => r.status === "QUEUED" || r.status === "RUNNING") ? 2500 : false) });
  const usage = useQuery({ queryKey: ["usage", org.slug], queryFn: () => api.usage(org.slug) });
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [project, setProject] = useState("");
  const list = useMemo(() => (reviews.data ?? []).filter((r) => (!q || r.title.toLowerCase().includes(q.toLowerCase())) && (!status || r.status === status) && (!project || r.project.name === project)), [reviews.data, q, status, project]);
  const projects = [...new Set((reviews.data ?? []).map((r) => r.project.name))];
  const canReview = atLeast(org.role, "REVIEWER");

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Reviews" subtitle={`${org.name} · ${org.limits.label} plan`} actions={canReview && <Link href={`/o/${org.slug}/reviews/new`}><Button variant="primary"><Plus className="size-4" /> New review</Button></Link>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <section aria-label="Review list" className="min-w-0">
          <div className="mb-3 flex flex-wrap gap-2">
            <Input aria-label="Search reviews" placeholder="Search titles…" value={q} onChange={(e) => setQ(e.target.value)} className="w-full min-w-0 flex-1 sm:w-auto sm:min-w-48" />
            <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {["QUEUED", "RUNNING", "COMPLETED", "FAILED"].map((s) => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>)}
            </Select>
            <Select aria-label="Filter by project" value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">All projects</option>
              {projects.map((p) => <option key={p}>{p}</option>)}
            </Select>
          </div>
          {reviews.error ? (
            <ErrorNote error={reviews.error} onRetry={() => reviews.refetch()} />
          ) : reviews.isPending ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />)}</div>
          ) : !reviews.data.length ? (
            <Empty icon={<FileDiff className="size-5" />} title="No reviews yet" action={canReview && <Link href={`/o/${org.slug}/reviews/new`}><Button variant="primary">Submit a diff</Button></Link>}>
              Paste a unified diff or load the sample to see deterministic checks and model findings side by side.
            </Empty>
          ) : !list.length ? (
            <p className="py-10 text-center text-sm text-muted">No reviews match these filters.</p>
          ) : (
            <Card className="divide-y divide-line">
              {list.map((r) => (
                <Link key={r.id} href={`/o/${org.slug}/reviews/${r.id}`} className="flex flex-col items-start gap-2 px-4 py-3.5 hover:bg-panel-2 sm:flex-row sm:items-center sm:gap-4">
                  <div className="w-full min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{r.title}</span>
                      {r.version > 1 && <Chip tone="copper">v{r.version}</Chip>}
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {r.project.name} · {relTime(r.createdAt)} · {r.stats.files ?? 0} files <span className="text-add-ink">+{r.stats.additions ?? 0}</span> <span className="text-del-ink">−{r.stats.deletions ?? 0}</span>
                      {r.durationMs != null && <> · {fmtMs(r.durationMs)}</>}
                    </div>
                  </div>
                  <SeverityBar by={r.stats.bySeverity} />
                  <StatusBadge status={r.status} />
                </Link>
              ))}
            </Card>
          )}
        </section>
        <aside className="min-w-0 space-y-4">
          <Card className="space-y-4 p-4">
            <h2 className="text-sm font-semibold">This month</h2>
            {usage.data ? (
              <>
                <Meter label="Reviews" used={usage.data.reviews.used} limit={usage.data.reviews.limit} />
                <Meter label="LLM tokens" used={usage.data.llmTokens.used} limit={usage.data.llmTokens.limit} />
                <Meter label="Seats" used={usage.data.seats.used} limit={usage.data.seats.limit} />
                <Meter label="Projects" used={usage.data.projects.used} limit={usage.data.projects.limit} />
                <p className="text-xs text-muted">Avg processing {fmtMs(usage.data.processing.avgMs)} · metered from stored usage records</p>
              </>
            ) : usage.error ? (
              <ErrorNote error={usage.error} />
            ) : (
              <Skeleton className="h-32" />
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
