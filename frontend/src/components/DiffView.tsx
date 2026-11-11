"use client";

import { ChevronDown, ChevronRight, FileCode2 } from "lucide-react";
import { Fragment, useState } from "react";
import { cn } from "@/lib/cn";
import type { Finding, ReviewFile } from "@/lib/types";
import { SEVERITY_TONE } from "./ui";

const MARK: Record<string, string> = { crit: "bg-crit", copper: "bg-copper", sapphire: "bg-sapphire", neutral: "bg-muted", ok: "bg-ok" };

/**
 * Unified diff viewer built from the parsed hunks the API stores. Lines cited by a finding get
 * a severity marker in the gutter; selecting a marker selects the finding in the panel.
 */
export function DiffView({ files, findings, selected, onSelect }: { files: ReviewFile[]; findings: Finding[]; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="space-y-4">
      {files.map((f) => (
        <FileDiff key={f.id} file={f} findings={findings.filter((x) => x.path === f.path)} selected={selected} onSelect={onSelect} />
      ))}
    </div>
  );
}

function FileDiff({ file, findings, selected, onSelect }: { file: ReviewFile; findings: Finding[]; selected: string | null; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(true);
  const byLine = new Map<number, Finding[]>();
  for (const f of findings) for (let l = f.lineStart; l <= f.lineEnd; l++) byLine.set(l, [...(byLine.get(l) ?? []), f]);
  const sel = findings.find((f) => f.id === selected);
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-panel" aria-label={`Diff of ${file.path}`}>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 border-b border-line bg-panel-2 px-3 py-2 text-left text-sm">
        {open ? <ChevronDown className="size-4 text-muted" /> : <ChevronRight className="size-4 text-muted" />}
        <FileCode2 className="size-4 text-muted" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
          {file.oldPath && file.oldPath !== file.path ? <>{file.oldPath} → </> : null}
          {file.path}
        </span>
        <span className="font-mono text-xs text-add-ink">+{file.additions}</span>
        <span className="font-mono text-xs text-del-ink">−{file.deletions}</span>
        {findings.length > 0 && <span className="rounded bg-copper-soft px-1.5 text-[11px] font-medium text-copper">{findings.length} finding{findings.length > 1 ? "s" : ""}</span>}
      </button>
      {open && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-mono text-xs leading-5">
            <tbody>
              {file.hunks.map((h, hi) => (
                <Fragment key={hi}>
                  <tr className="bg-sapphire-soft/50 text-muted">
                    <td colSpan={4} className="px-3 py-1">
                      @@ -{h.oldStart},{h.oldLines} +{h.newStart},{h.newLines} @@ {h.header}
                    </td>
                  </tr>
                  {h.lines.map((l, li) => {
                    const fs = l.newLine != null && l.type !== "del" ? byLine.get(l.newLine) : undefined;
                    const top = fs?.slice().sort((a, b) => ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"].indexOf(a.severity) - ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"].indexOf(b.severity))[0];
                    const isSel = !!sel && l.newLine != null && l.newLine >= sel.lineStart && l.newLine <= sel.lineEnd && l.type !== "del";
                    return (
                      <tr key={li} id={l.newLine != null ? `L-${file.id}-${l.newLine}` : undefined} className={cn(l.type === "add" && "bg-add", l.type === "del" && "bg-del", isSel && "outline outline-1 -outline-offset-1 outline-copper")}>
                        <td className="w-1 p-0">
                          {top && (
                            <button onClick={() => onSelect(top.id)} aria-label={`${fs!.length} finding${fs!.length > 1 ? "s" : ""} on line ${l.newLine}: ${top.title}`} title={fs!.map((x) => x.title).join("\n")} className={cn("block h-5 w-1", MARK[SEVERITY_TONE[top.severity]])} />
                          )}
                        </td>
                        <td className="w-10 select-none pr-2 text-right text-muted/70">{l.oldLine ?? ""}</td>
                        <td className="w-10 select-none border-r border-line pr-2 text-right text-muted/70">{l.newLine ?? ""}</td>
                        <td className={cn("whitespace-pre px-3", l.type === "add" && "text-add-ink", l.type === "del" && "text-del-ink")}>
                          <span className="select-none pr-2 opacity-60">{l.type === "add" ? "+" : l.type === "del" ? "-" : " "}</span>
                          {l.text}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
