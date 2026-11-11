"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { api } from "@/lib/api";
import { useMe } from "@/lib/session";
import { Button, ErrorNote, Skeleton } from "./ui";

export function InviteAccept() {
  const token = useSearchParams().get("token") ?? "";
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const next = encodeURIComponent(`/invite?token=${token}`);
  const m = useMutation({
    mutationFn: () => api.acceptInvite(token),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      router.replace(`/o/${r.organization}`);
    },
  });
  if (me.isPending) return <Skeleton className="h-32" />;
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold">Join an organization</h1>
      {!token ? (
        <div className="mt-6"><ErrorNote error="This page needs the token from your invitation link." /></div>
      ) : !me.data ? (
        <div className="mt-6 space-y-4 text-sm">
          <p className="text-muted">Sign in or create an account with the email address the invitation was sent to.</p>
          <div className="flex gap-2">
            <Link href={`/login?next=${next}`}><Button variant="primary">Sign in</Button></Link>
            <Link href={`/register?next=${next}`}><Button>Create account</Button></Link>
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-4 text-sm">
          <p className="text-muted">Signed in as <strong className="text-ink">{me.data.email}</strong>. Invitations are bound to the invited email address.</p>
          {m.error && <ErrorNote error={m.error} />}
          <Button variant="primary" onClick={() => m.mutate()} disabled={m.isPending}>Accept invitation</Button>
        </div>
      )}
    </div>
  );
}

export function Onboarding() {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const m = useMutation({
    mutationFn: (name: string) => api.createOrg(name),
    onSuccess: async (o) => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      router.replace(`/o/${o.slug}`);
    },
  });
  useEffect(() => {
    if (me.data === null) router.replace("/login");
  }, [me.data, router]);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate(String(new FormData(e.currentTarget).get("name")));
      }}
    >
      <h1 className="font-display text-2xl font-semibold">Create an organization</h1>
      <p className="text-sm text-muted">Organizations hold projects, reviews, members and usage. Data never crosses organizations.</p>
      <input name="name" required minLength={2} maxLength={80} className="h-10 rounded-lg border border-line bg-panel px-3 text-sm" placeholder="Acme Engineering" />
      {m.error && <ErrorNote error={m.error} />}
      <Button type="submit" variant="primary" disabled={m.isPending}>Create organization</Button>
      <p className="text-xs text-muted">Waiting on an invitation? Open the link from your email instead.</p>
    </form>
  );
}

export function Mailbox() {
  const params = useSearchParams();
  const email = params.get("email") ?? "";
  const q = useOutbox(email);
  return (
    <main className="mx-auto max-w-2xl p-6 sm:p-12">
      <h1 className="font-display text-2xl font-semibold">Development mailbox</h1>
      <p className="mt-1 text-sm text-muted">The local mail transport never sends email. Messages for one address are shown here so the invitation and reset flows can be tested end to end. Disabled in production.</p>
      <form className="mt-6 flex gap-2" action="/mailbox">
        <input name="email" type="email" defaultValue={email} required placeholder="you@example.test" className="h-10 flex-1 rounded-lg border border-line bg-panel px-3 text-sm" />
        <Button type="submit">Open</Button>
      </form>
      <div className="mt-6 space-y-3">
        {q.error && <ErrorNote error={q.error} />}
        {q.data?.length === 0 && <p className="text-sm text-muted">No messages for {email}.</p>}
        {q.data?.map((m, i) => (
          <article key={i} className="rounded-xl border border-line bg-panel p-4 text-sm">
            <div className="flex justify-between gap-4 text-xs text-muted"><span>To {m.to}</span><time>{new Date(m.sentAt).toLocaleString()}</time></div>
            <h2 className="mt-1 font-medium">{m.subject}</h2>
            <p className="mt-2 break-all font-mono text-xs">
              {m.text.split(/(https?:\/\/\S+)/).map((part, j) => (/^https?:\/\//.test(part) ? <a key={j} className="text-sapphire underline" href={new URL(part).pathname + new URL(part).search}>{part}</a> : part))}
            </p>
          </article>
        ))}
      </div>
    </main>
  );
}

function useOutbox(email: string) {
  return useQuery({ queryKey: ["outbox", email], queryFn: () => api.outbox(email), enabled: !!email, refetchInterval: 3000 });
}
