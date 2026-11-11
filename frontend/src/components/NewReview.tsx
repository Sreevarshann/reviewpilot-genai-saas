"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { atLeast } from "@/lib/session";
import { useOrg } from "./Shell";
import { Button, Card, ErrorNote, Field, Input, PageHeader, Select } from "./ui";

const newKey = () => `ui-${crypto.randomUUID()}`;

export function NewReview() {
  const { org } = useOrg();
  const router = useRouter();
  const qc = useQueryClient();
  const projects = useQuery({ queryKey: ["projects", org.slug], queryFn: () => api.projects(org.slug) });
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [diff, setDiff] = useState("");
  const [newProject, setNewProject] = useState("");
  // One key per draft: a double-click or network retry replays the same review instead of creating two.
  const key = useRef(newKey());
  const fileRef = useRef<HTMLInputElement>(null);
  const pid = projectId || projects.data?.[0]?.id || "";
  const bytes = new TextEncoder().encode(diff).length;
  const tooBig = bytes > org.limits.maxDiffBytes;

  const submit = useMutation({
    mutationFn: () => api.submitReview(org.slug, { projectId: pid, title: title.trim(), diff }, key.current),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["reviews", org.slug] });
      qc.invalidateQueries({ queryKey: ["usage", org.slug] });
      router.push(`/o/${org.slug}/reviews/${r.id}`);
    },
  });
  const create = useMutation({
    mutationFn: () => api.createProject(org.slug, newProject.trim()),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["projects", org.slug] });
      setProjectId(p.id);
      setNewProject("");
    },
  });
  const edit = (fn: () => void) => {
    fn();
    key.current = newKey();
  };
  const loadSample = async () => {
    const text = await (await fetch("/sample.diff")).text();
    edit(() => setDiff(text));
    // functional update: the user may have typed a title while the sample was loading
    setTitle((t) => t || "Orders: item listing and discount endpoint");
  };

  if (!atLeast(org.role, "REVIEWER")) return <ErrorNote error="Viewers can read reviews but not submit them. Ask an admin for the reviewer role." />;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="New review" subtitle="Unified diffs from git diff, git format-patch or a PR's .diff URL. Only added lines are reviewed." />
      <Card className="space-y-5 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Project">
            {projects.data?.length ? (
              <Select value={pid} onChange={(e) => edit(() => setProjectId(e.target.value))}>
                {projects.data.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            ) : (
              <div className="flex gap-2">
                <Input placeholder="First project name" value={newProject} onChange={(e) => setNewProject(e.target.value)} className="flex-1" />
                <Button onClick={() => create.mutate()} disabled={!newProject.trim() || create.isPending}>Create</Button>
              </div>
            )}
          </Field>
          <Field label="Title"><Input value={title} maxLength={200} onChange={(e) => edit(() => setTitle(e.target.value))} placeholder="What does this change do?" /></Field>
        </div>
        {create.error && <ErrorNote error={create.error} />}
        <Field label="Diff" hint={<span className={tooBig ? "text-crit" : ""}>{(bytes / 1024).toFixed(1)} KB of {(org.limits.maxDiffBytes / 1024).toFixed(0)} KB allowed on the {org.limits.label} plan</span>}>
          <textarea value={diff} onChange={(e) => edit(() => setDiff(e.target.value))} spellCheck={false} rows={18} placeholder={"diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,3 +1,4 @@"} className="rounded-lg border border-line bg-panel-2 p-3 font-mono text-xs leading-5 focus:border-sapphire focus:outline-none" />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={loadSample}><Sparkles className="size-4" /> Load sample diff</Button>
          <Button onClick={() => fileRef.current?.click()}><FileUp className="size-4" /> Upload .diff / .patch</Button>
          <input ref={fileRef} type="file" accept=".diff,.patch,.txt,text/plain" hidden onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const text = await f.text();
              edit(() => setDiff(text));
            }}
          />
          <div className="flex-1" />
          <Link href={`/o/${org.slug}`}><Button variant="ghost">Cancel</Button></Link>
          <Button variant="primary" disabled={!pid || !title.trim() || diff.length < 10 || tooBig || submit.isPending} onClick={() => submit.mutate()}>{submit.isPending ? "Submitting…" : "Run review"}</Button>
        </div>
        {submit.error && <ErrorNote error={submit.error} />}
      </Card>
    </div>
  );
}
