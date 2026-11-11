"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, Check, MessageSquare, RotateCcw, ShieldCheck, ThumbsDown, X } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { atLeast } from "@/lib/session";
import type { Finding, FindingState, Member } from "@/lib/types";
import { useOrg } from "./Shell";
import { Button, Chip, ErrorNote, relTime, SeverityChip } from "./ui";

const STATE_LABEL: Record<FindingState, string> = { OPEN: "Open", ACCEPTED: "Accepted", DISMISSED: "Dismissed", FALSE_POSITIVE: "False positive" };
const CATEGORY_LABEL = (c: string) => c.replace("_", " ").toLowerCase();

export function FindingCard({ f, selected, onSelect, members, reviewId }: { f: Finding; selected: boolean; onSelect: () => void; members: Member[]; reviewId: string }) {
  const { org } = useOrg();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [comment, setComment] = useState("");
  const canTriage = atLeast(org.role, "REVIEWER");
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["findings", org.slug, reviewId] });
    qc.invalidateQueries({ queryKey: ["analytics", org.slug] });
  };
  const setState = useMutation({ mutationFn: (s: FindingState) => api.setFindingState(org.slug, f.id, s, note.trim() || undefined), onSuccess: () => (setNote(""), refresh()) });
  const addComment = useMutation({ mutationFn: () => api.comment(org.slug, f.id, comment.trim()), onSuccess: () => (setComment(""), refresh()) });
  const who = (id: string) => members.find((m) => m.user.id === id)?.user.name ?? "Former member";

  return (
    <article id={`finding-${f.id}`} className={cn("rounded-xl border bg-panel transition-colors", selected ? "border-copper ring-1 ring-copper/40" : "border-line", f.state !== "OPEN" && !selected && "opacity-75")}>
      <button onClick={onSelect} className="w-full px-4 pt-3.5 text-left" aria-expanded={selected}>
        <div className="flex flex-wrap items-center gap-1.5">
          <SeverityChip severity={f.severity} />
          <Chip>{CATEGORY_LABEL(f.category)}</Chip>
          {f.confidence === "DETERMINISTIC" ? (
            <Chip tone="sapphire" title={`Deterministic rule ${f.source}`}><ShieldCheck className="size-3" />rule</Chip>
          ) : (
            <Chip tone="copper" title="Model finding; evidence verified against the cited lines"><Bot className="size-3" />model</Chip>
          )}
          {f.state !== "OPEN" && <Chip tone={f.state === "ACCEPTED" ? "ok" : "neutral"}>{STATE_LABEL[f.state]}</Chip>}
        </div>
        <h3 className="mt-2 text-sm font-medium">{f.title}</h3>
        <div className="mt-0.5 truncate font-mono text-[11px] text-muted">
          {f.path}:{f.lineStart}
          {f.lineEnd !== f.lineStart && `-${f.lineEnd}`}
        </div>
      </button>
      <div className="px-4 pb-3.5">
        {selected ? (
          <div className="mt-3 space-y-3 text-sm">
            <p className="text-muted">{f.description}</p>
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Evidence</div>
              <pre className="overflow-x-auto rounded-lg bg-panel-2 p-2.5 font-mono text-xs">{f.evidence}</pre>
            </div>
            {f.suggestedFix && (
              <div>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Suggested fix</div>
                <p className="whitespace-pre-wrap">{f.suggestedFix}</p>
              </div>
            )}
            <div className="text-[11px] text-muted">Source: <span className="font-mono">{f.source}</span></div>
            {canTriage && (
              <div className="space-y-2 border-t border-line pt-3">
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Optional note for the audit log" className="h-8 w-full rounded-md border border-line bg-panel px-2.5 text-xs" aria-label="Triage note" />
                <div className="flex flex-wrap gap-1.5">
                  {f.state === "OPEN" ? (
                    <>
                      <Button size="sm" onClick={() => setState.mutate("ACCEPTED")} disabled={setState.isPending}><Check className="size-3.5" />Accept</Button>
                      <Button size="sm" onClick={() => setState.mutate("DISMISSED")} disabled={setState.isPending}><X className="size-3.5" />Dismiss</Button>
                      <Button size="sm" onClick={() => setState.mutate("FALSE_POSITIVE")} disabled={setState.isPending}><ThumbsDown className="size-3.5" />False positive</Button>
                    </>
                  ) : (
                    <Button size="sm" onClick={() => setState.mutate("OPEN")} disabled={setState.isPending}><RotateCcw className="size-3.5" />Reopen</Button>
                  )}
                </div>
                {setState.error && <ErrorNote error={setState.error} />}
              </div>
            )}
            <div className="space-y-2 border-t border-line pt-3">
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted"><MessageSquare className="size-3" />Discussion ({f.comments.length})</div>
              {f.comments.map((c) => (
                <div key={c.id} className="rounded-lg bg-panel-2 px-3 py-2 text-xs">
                  <div className="text-muted">{who(c.authorId)} · {relTime(c.createdAt)}</div>
                  <p className="mt-0.5 whitespace-pre-wrap">{c.body}</p>
                </div>
              ))}
              {canTriage && (
                <form className="flex gap-1.5" onSubmit={(e) => (e.preventDefault(), comment.trim() && addComment.mutate())}>
                  <input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} placeholder="Add a comment" className="h-8 flex-1 rounded-md border border-line bg-panel px-2.5 text-xs" aria-label="Comment" />
                  <Button size="sm" type="submit" disabled={!comment.trim() || addComment.isPending}>Post</Button>
                </form>
              )}
              {addComment.error && <ErrorNote error={addComment.error} />}
            </div>
          </div>
        ) : (
          <p className="mt-1 line-clamp-2 text-xs text-muted">{f.description}</p>
        )}
      </div>
    </article>
  );
}
