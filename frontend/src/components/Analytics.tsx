"use client";

import { useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { PALETTE, Plot } from "./Plot";
import { useOrg } from "./Shell";
import { useTheme } from "./theme";
import { Card, Empty, ErrorNote, fmtMs, Meter, PageHeader, Select, Skeleton } from "./ui";

// bar width in ms on a date axis (Plotly cannot infer it from a single day of data)
const DAY_BAR = 0.7 * 86_400_000;
const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </Card>
  );
}

const Panel = ({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) => (
  <Card className="p-4">
    <h2 className="text-sm font-semibold">{title}</h2>
    {sub && <p className="text-xs text-muted">{sub}</p>}
    <div className="mt-2">{children}</div>
  </Card>
);

export function Analytics() {
  const { org } = useOrg();
  const { theme } = useTheme();
  const c = PALETTE[theme === "dark" ? "dark" : "light"];
  const [days, setDays] = useState(30);
  const [projectId, setProjectId] = useState("");
  const projects = useQuery({ queryKey: ["projects", org.slug], queryFn: () => api.projects(org.slug) });
  const q = useQuery({ queryKey: ["analytics", org.slug, days, projectId], queryFn: () => api.analytics(org.slug, days, projectId || undefined) });
  const usage = useQuery({ queryKey: ["usage", org.slug], queryFn: () => api.usage(org.slug) });
  const a = q.data;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Analytics"
        subtitle="Aggregated from stored reviews, findings and triage decisions in this organization."
        actions={
          <>
            <Select aria-label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">All projects</option>
              {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Select aria-label="Window" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {[7, 30, 90, 365].map((d) => <option key={d} value={d}>Last {d} days</option>)}
            </Select>
          </>
        }
      />
      {q.error ? (
        <ErrorNote error={q.error} onRetry={() => q.refetch()} />
      ) : !a ? (
        <div className="grid gap-4 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : a.reviews.total === 0 ? (
        <Empty icon={<BarChart3 className="size-5" />} title="No reviews in this window">Charts fill in as reviews complete and findings are triaged.</Empty>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
            <Stat label="Reviews" value={a.reviews.total} sub={`${a.reviews.completed} completed · ${a.reviews.failed} failed${a.reviews.pending ? ` · ${a.reviews.pending} pending` : ""}`} />
            <Stat label="Median latency" value={fmtMs(a.latencyMs.p50 == null ? null : Math.round(a.latencyMs.p50))} sub={`p90 ${fmtMs(a.latencyMs.p90 == null ? null : Math.round(a.latencyMs.p90))} · ${a.latencyMs.samples} samples`} />
            <Stat label="Findings triaged" value={a.triage.all.triaged} sub={`${a.triage.all.open} still open`} />
            <Stat label="Acceptance (triaged)" value={pct(a.triage.all.acceptanceRate)} sub={`rules ${pct(a.triage.deterministic.acceptanceRate)} · model ${pct(a.triage.model.acceptanceRate)}`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Panel title="Reviews over time">
              <Plot label="Reviews per day by outcome" data={[
                { type: "bar", name: "Completed", x: a.reviewsOverTime.map((d) => d.day), y: a.reviewsOverTime.map((d) => d.completed), width: DAY_BAR, marker: { color: c.sapphire } },
                { type: "bar", name: "Failed", x: a.reviewsOverTime.map((d) => d.day), y: a.reviewsOverTime.map((d) => d.failed), width: DAY_BAR, marker: { color: c.crit } },
              ]} layout={{ barmode: "stack", xaxis: { type: "date", range: [a.range.from.slice(0, 10), new Date(Date.parse(a.range.to) + 86_400_000).toISOString().slice(0, 10)], tickformat: "%b %d" } }} />
            </Panel>
            <Panel title="Findings by severity">
              <Plot label="Findings by severity" data={[{ type: "bar", x: a.findingsBySeverity.map((s) => s.severity.toLowerCase()), y: a.findingsBySeverity.map((s) => s.count), marker: { color: [c.crit, c.crit, c.copper, c.sapphire, c.muted] } }]} layout={{ showlegend: false }} />
            </Panel>
            <Panel title="Findings by category" sub="Split by source: deterministic rules vs grounded model findings">
              {(() => {
                const cats = [...new Set(a.findingsByCategory.map((r) => r.category))];
                const val = (cat: string, conf: string) => a.findingsByCategory.find((r) => r.category === cat && r.confidence === conf)?.count ?? 0;
                return (
                  <Plot label="Findings by category and source" data={[
                    { type: "bar", orientation: "h", name: "Rules", y: cats.map((x) => x.replace("_", " ").toLowerCase()), x: cats.map((x) => val(x, "DETERMINISTIC")), marker: { color: c.sapphire } },
                    { type: "bar", orientation: "h", name: "Model", y: cats.map((x) => x.replace("_", " ").toLowerCase()), x: cats.map((x) => val(x, "MODEL")), marker: { color: c.copper } },
                  ]} layout={{ barmode: "stack", margin: { l: 110, r: 12, t: 8, b: 40 } }} />
                );
              })()}
            </Panel>
            <Panel title="Triage outcomes" sub={a.triage.note}>
              <Plot label="Triage outcomes by source" data={(["accepted", "dismissed", "falsePositive", "open"] as const).map((k, i) => ({
                type: "bar", name: { accepted: "Accepted", dismissed: "Dismissed", falsePositive: "False positive", open: "Open" }[k],
                x: ["Rules", "Model"], y: [a.triage.deterministic[k], a.triage.model[k]], marker: { color: [c.ok, c.muted, c.crit, c.sapphire][i] },
              }))} layout={{ barmode: "stack" }} />
            </Panel>
          </div>
          <div className="grid gap-4 lg:grid-cols-[1fr_320px] [&>*]:min-w-0">
            <Panel title="Top rules and sources">
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted"><tr><th className="py-1.5 font-medium">Source</th><th className="font-medium">Findings</th><th className="font-medium">Accepted</th><th className="font-medium">Rejected</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {a.topRules.map((r) => <tr key={r.source}><td className="py-1.5 font-mono text-xs">{r.source}</td><td className="tabular-nums">{r.count}</td><td className="tabular-nums text-ok">{r.accepted}</td><td className="tabular-nums text-crit">{r.rejected}</td></tr>)}
                </tbody>
              </table>
              </div>
            </Panel>
            <div className="space-y-4">
              <Panel title="Model usage">
                {a.models.map((m) => (
                  <div key={`${m.provider}/${m.model}`} className="flex justify-between gap-3 py-1 text-sm">
                    <span className="truncate">{m.provider} · <span className="font-mono text-xs">{m.model ?? "none"}</span></span>
                    <span className="shrink-0 text-xs tabular-nums text-muted">{m.reviews} reviews · {(m.tokensIn + m.tokensOut).toLocaleString()} tok</span>
                  </div>
                ))}
              </Panel>
              <Panel title="Usage against plan">
                {usage.data ? (
                  <div className="space-y-3">
                    <Meter label="Reviews this month" used={usage.data.reviews.used} limit={usage.data.reviews.limit} />
                    <Meter label="LLM tokens this month" used={usage.data.llmTokens.used} limit={usage.data.llmTokens.limit} />
                  </div>
                ) : <Skeleton className="h-16" />}
              </Panel>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
