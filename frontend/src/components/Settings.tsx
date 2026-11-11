"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { atLeast } from "@/lib/session";
import type { Plan, Role } from "@/lib/types";
import { useOrg } from "./Shell";
import { Button, Card, Chip, ErrorNote, Field, fmtDate, Input, PageHeader, relTime, Select, Skeleton } from "./ui";

const ROLES: Role[] = ["OWNER", "ADMIN", "REVIEWER", "VIEWER"];
const roleLabel = (r: string) => r[0] + r.slice(1).toLowerCase();

export function Settings() {
  const { org } = useOrg();
  const admin = atLeast(org.role, "ADMIN");
  const tabs = [
    { id: "general", label: "General", el: <General /> },
    { id: "members", label: "Members", el: <Members /> },
    { id: "projects", label: "Projects", el: <Projects /> },
    { id: "plan", label: "Plan & usage", el: <PlanTab /> },
    ...(admin ? [{ id: "tokens", label: "API tokens", el: <Tokens /> }, { id: "audit", label: "Audit log", el: <Audit /> }] : []),
  ];
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Organization" subtitle={<>{org.name} · <span className="font-mono">{org.slug}</span> · you are {org.role.toLowerCase()}</>} />
      <Tabs.Root defaultValue="general">
        <Tabs.List className="mb-5 flex gap-1 overflow-x-auto border-b border-line" aria-label="Organization settings">
          {tabs.map((t) => (
            <Tabs.Trigger key={t.id} value={t.id} className="-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm text-muted hover:text-ink data-[state=active]:border-sapphire data-[state=active]:font-medium data-[state=active]:text-ink">
              {t.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {tabs.map((t) => <Tabs.Content key={t.id} value={t.id}>{t.el}</Tabs.Content>)}
      </Tabs.Root>
    </div>
  );
}

function General() {
  const { org } = useOrg();
  const qc = useQueryClient();
  const admin = atLeast(org.role, "ADMIN");
  const [name, setName] = useState(org.name);
  const [days, setDays] = useState(org.retentionDays);
  const save = useMutation({ mutationFn: () => api.updateOrg(org.slug, { name, retentionDays: days }), onSuccess: () => qc.invalidateQueries({ queryKey: ["org", org.slug] }) });
  const retention = useMutation({ mutationFn: () => api.runRetention(org.slug), onSuccess: () => qc.invalidateQueries({ queryKey: ["reviews", org.slug] }) });
  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} disabled={!admin} /></Field>
        <Field label="Review retention (days)" hint="Finished reviews older than this are deleted with their files, findings and comments by a daily job. 7–3650 days.">
          <Input type="number" min={7} max={3650} value={days} onChange={(e) => setDays(Number(e.target.value))} disabled={!admin} className="w-40" />
        </Field>
        {save.error && <ErrorNote error={save.error} />}
        {admin && <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>{save.isSuccess && !save.isPending ? "Saved" : "Save changes"}</Button>}
      </Card>
      {admin && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h3 className="text-sm font-medium">Enforce retention now</h3>
            <p className="text-xs text-muted">Runs the same deletion the daily job performs, for this organization only. Audited.</p>
            {retention.data && <p className="mt-1 text-xs text-ok">Deleted {retention.data.deletedReviews} review(s).</p>}
          </div>
          <Button variant="danger" onClick={() => retention.mutate()} disabled={retention.isPending}>Run retention</Button>
        </Card>
      )}
    </div>
  );
}

function Members() {
  const { org, me } = useOrg();
  const qc = useQueryClient();
  const admin = atLeast(org.role, "ADMIN");
  const members = useQuery({ queryKey: ["members", org.slug], queryFn: () => api.members(org.slug) });
  const invites = useQuery({ queryKey: ["invites", org.slug], queryFn: () => api.invitations(org.slug), enabled: admin });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("REVIEWER");
  const inv = () => (qc.invalidateQueries({ queryKey: ["members", org.slug] }), qc.invalidateQueries({ queryKey: ["invites", org.slug] }), qc.invalidateQueries({ queryKey: ["usage", org.slug] }));
  const invite = useMutation({ mutationFn: () => api.invite(org.slug, email, role), onSuccess: () => (setEmail(""), inv()) });
  const setR = useMutation({ mutationFn: (v: { userId: string; role: Role }) => api.setRole(org.slug, v.userId, v.role), onSuccess: inv });
  const remove = useMutation({ mutationFn: (userId: string) => api.removeMember(org.slug, userId), onSuccess: inv });
  const revoke = useMutation({ mutationFn: (id: string) => api.revokeInvite(org.slug, id), onSuccess: inv });
  const err = setR.error ?? remove.error ?? revoke.error;
  return (
    <div className="space-y-4">
      {admin && (
        <Card className="p-5">
          <h3 className="text-sm font-medium">Invite a teammate</h3>
          <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => (e.preventDefault(), invite.mutate())}>
            <Input type="email" required placeholder="teammate@company.com" value={email} onChange={(e) => setEmail(e.target.value)} className="min-w-56 flex-1" aria-label="Invite email" />
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Invite role">
              {ROLES.filter((r) => org.role === "OWNER" || (r !== "OWNER" && r !== "ADMIN")).map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </Select>
            <Button type="submit" variant="primary" disabled={invite.isPending}>Send invite</Button>
          </form>
          <p className="mt-2 text-xs text-muted">Invitations are single-use, bound to the email address and expire in 7 days. Locally they land in the <a className="text-sapphire hover:underline" href={`/mailbox?email=${encodeURIComponent(email)}`}>development mailbox</a>.</p>
          {invite.error && <div className="mt-2"><ErrorNote error={invite.error} /></div>}
          {!!invites.data?.length && (
            <ul className="mt-4 divide-y divide-line border-t border-line text-sm">
              {invites.data.map((i) => (
                <li key={i.id} className="flex items-center gap-3 py-2">
                  <span className="flex-1 truncate">{i.email}</span>
                  <Chip>{roleLabel(i.role)}</Chip>
                  <span className="text-xs text-muted">expires {fmtDate(i.expiresAt)}</span>
                  <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)}>Revoke</Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {err && <ErrorNote error={err} />}
      <Card className="divide-y divide-line">
        {members.isPending ? <Skeleton className="m-4 h-20" /> : members.error ? <div className="p-4"><ErrorNote error={members.error} /></div> : members.data.map((m) => (
          <div key={m.user.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="grid size-8 place-items-center rounded-full bg-panel-2 text-xs font-semibold">{m.user.name[0]?.toUpperCase()}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{m.user.name}{m.user.id === me.id && <span className="text-muted"> (you)</span>}</div>
              <div className="truncate text-xs text-muted">{m.user.email} · joined {relTime(m.createdAt)}</div>
            </div>
            {admin && m.user.id !== me.id ? (
              <>
                <Select className="h-8 text-xs" value={m.role} onChange={(e) => setR.mutate({ userId: m.user.id, role: e.target.value as Role })} aria-label={`Role for ${m.user.name}`}>
                  {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                </Select>
                <Button size="sm" variant="ghost" onClick={() => confirm(`Remove ${m.user.name} from ${org.name}?`) && remove.mutate(m.user.id)} aria-label={`Remove ${m.user.name}`}><Trash2 className="size-3.5" /></Button>
              </>
            ) : <Chip>{roleLabel(m.role)}</Chip>}
          </div>
        ))}
      </Card>
    </div>
  );
}

function Projects() {
  const { org } = useOrg();
  const qc = useQueryClient();
  const admin = atLeast(org.role, "ADMIN");
  const q = useQuery({ queryKey: ["projects", org.slug], queryFn: () => api.projects(org.slug) });
  const [name, setName] = useState("");
  const create = useMutation({ mutationFn: () => api.createProject(org.slug, name.trim()), onSuccess: () => (setName(""), qc.invalidateQueries({ queryKey: ["projects", org.slug] })) });
  const del = useMutation({ mutationFn: (id: string) => api.deleteProject(org.slug, id), onSuccess: () => (qc.invalidateQueries({ queryKey: ["projects", org.slug] }), qc.invalidateQueries({ queryKey: ["reviews", org.slug] })) });
  return (
    <div className="space-y-4">
      {admin && (
        <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), create.mutate())}>
          <Input required placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} className="flex-1" aria-label="Project name" />
          <Button type="submit" variant="primary" disabled={create.isPending}>Add project</Button>
        </form>
      )}
      {(create.error ?? del.error) && <ErrorNote error={create.error ?? del.error} />}
      <Card className="divide-y divide-line">
        {q.data?.map((p) => (
          <div key={p.id} className="flex items-center gap-3 px-4 py-3 text-sm">
            <span className="flex-1 font-medium">{p.name}</span>
            <span className="text-xs text-muted">{p._count?.reviews ?? 0} reviews · created {relTime(p.createdAt)}</span>
            {admin && <Button size="sm" variant="ghost" onClick={() => confirm(`Delete project ${p.name} and all of its reviews?`) && del.mutate(p.id)} aria-label={`Delete ${p.name}`}><Trash2 className="size-3.5" /></Button>}
          </div>
        ))}
        {q.data?.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted">No projects yet.</p>}
      </Card>
    </div>
  );
}

function PlanTab() {
  const { org } = useOrg();
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: ["plans"], queryFn: api.plans });
  const change = useMutation({ mutationFn: (p: Plan) => api.changePlan(org.slug, p), onSuccess: () => (qc.invalidateQueries({ queryKey: ["org", org.slug] }), qc.invalidateQueries({ queryKey: ["usage", org.slug] })) });
  const owner = org.role === "OWNER";
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-copper/30 bg-copper-soft px-4 py-3 text-sm text-copper">{plans.data?.note ?? "Local demo tiers."} Switching plans here is a mock: nothing is charged and no payment details are collected.</div>
      {change.data && <p className="text-sm text-ok">{change.data.note}</p>}
      {change.error && <ErrorNote error={change.error} />}
      <div className="grid gap-4 sm:grid-cols-3">
        {plans.data?.plans.map((p) => (
          <Card key={p.id} className={`flex flex-col gap-3 p-5 ${p.id === org.plan ? "border-sapphire ring-1 ring-sapphire/30" : ""}`}>
            <div className="flex items-center justify-between"><h3 className="font-display text-lg font-semibold">{p.label}</h3>{p.id === org.plan && <Chip tone="sapphire">Current</Chip>}</div>
            <ul className="space-y-1 text-sm text-muted">
              <li>{p.reviewsPerMonth.toLocaleString()} reviews / month</li>
              <li>{(p.llmTokensPerMonth / 1000).toLocaleString()}k LLM tokens / month</li>
              <li>{p.seats} seats · {p.projects} projects</li>
              <li>{(p.maxDiffBytes / 1024).toLocaleString()} KB max diff</li>
            </ul>
            {owner && p.id !== org.plan && <Button className="mt-auto" onClick={() => change.mutate(p.id)} disabled={change.isPending}>Switch (demo)</Button>}
          </Card>
        ))}
      </div>
      {!owner && <p className="text-xs text-muted">Only owners can change the plan.</p>}
    </div>
  );
}

function Tokens() {
  const { org } = useOrg();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["tokens", org.slug], queryFn: () => api.tokens(org.slug) });
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<{ token: string; name: string } | null>(null);
  const create = useMutation({ mutationFn: () => api.createToken(org.slug, name.trim()), onSuccess: (t) => (setFresh({ token: t.token, name: t.name }), setName(""), qc.invalidateQueries({ queryKey: ["tokens", org.slug] })) });
  const revoke = useMutation({ mutationFn: (id: string) => api.revokeToken(org.slug, id), onSuccess: () => qc.invalidateQueries({ queryKey: ["tokens", org.slug] }) });
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h3 className="text-sm font-medium">Create a token</h3>
        <p className="mt-1 text-xs text-muted">Tokens act with reviewer rights on this organization only (submit and read reviews, triage findings) and authenticate the signed webhook. Only a SHA-256 hash is stored.</p>
        <form className="mt-3 flex gap-2" onSubmit={(e) => (e.preventDefault(), create.mutate())}>
          <Input required maxLength={80} placeholder="e.g. ci-pipeline" value={name} onChange={(e) => setName(e.target.value)} className="flex-1" aria-label="Token name" />
          <Button type="submit" variant="primary" disabled={create.isPending}><KeyRound className="size-4" />Create</Button>
        </form>
        {create.error && <div className="mt-2"><ErrorNote error={create.error} /></div>}
        {fresh && (
          <div className="mt-4 rounded-lg border border-ok/30 bg-ok-soft p-3 text-sm">
            <p className="font-medium text-ok">Copy “{fresh.name}” now — it will not be shown again.</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-panel px-2 py-1.5 font-mono text-xs">{fresh.token}</code>
              <Button size="sm" onClick={() => navigator.clipboard.writeText(fresh.token)} aria-label="Copy token"><Copy className="size-3.5" /></Button>
            </div>
          </div>
        )}
      </Card>
      {revoke.error && <ErrorNote error={revoke.error} />}
      <Card className="divide-y divide-line">
        {q.data?.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <span className="font-medium">{t.name}</span>
            <code className="font-mono text-xs text-muted">{t.prefix}…</code>
            <span className="flex-1 text-xs text-muted">created {relTime(t.createdAt)} · {t.lastUsedAt ? `last used ${relTime(t.lastUsedAt)}` : "never used"}</span>
            {t.revokedAt ? <Chip tone="crit">Revoked</Chip> : <Button size="sm" variant="danger" onClick={() => revoke.mutate(t.id)}>Revoke</Button>}
          </div>
        ))}
        {q.data?.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted">No tokens.</p>}
      </Card>
    </div>
  );
}

function Audit() {
  const { org } = useOrg();
  const q = useQuery({ queryKey: ["audit", org.slug], queryFn: () => api.audit(org.slug) });
  const members = useQuery({ queryKey: ["members", org.slug], queryFn: () => api.members(org.slug) });
  const who = (id?: string | null) => (id ? (members.data?.find((m) => m.user.id === id)?.user.name ?? "Former member") : "System");
  if (q.error) return <ErrorNote error={q.error} />;
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-line text-left text-xs text-muted"><tr><th className="px-4 py-2 font-medium">When</th><th className="font-medium">Actor</th><th className="font-medium">Action</th><th className="pr-4 font-medium">Details</th></tr></thead>
        <tbody className="divide-y divide-line">
          {q.data?.map((e) => (
            <tr key={e.id}>
              <td className="whitespace-nowrap px-4 py-2 text-xs text-muted">{fmtDate(e.createdAt)}</td>
              <td className="whitespace-nowrap pr-3">{who(e.actorId)}</td>
              <td className="pr-3 font-mono text-xs">{e.action}</td>
              <td className="max-w-80 truncate pr-4 font-mono text-[11px] text-muted" title={JSON.stringify(e.metadata)}>{Object.keys(e.metadata ?? {}).length ? JSON.stringify(e.metadata) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!q.data && <Skeleton className="m-4 h-32" />}
    </Card>
  );
}
