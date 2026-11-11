"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Logo } from "./Logo";
import { Button, ErrorNote, Field, Input } from "./ui";

function Head({ title, sub }: { title: string; sub: React.ReactNode }) {
  return (
    <div className="mb-8">
      <Logo className="mb-6 size-9 lg:hidden" />
      <h1 className="font-display text-2xl font-semibold">{title}</h1>
      <p className="mt-1.5 text-sm text-muted">{sub}</p>
    </div>
  );
}

function useAfterAuth() {
  const router = useRouter();
  const qc = useQueryClient();
  const next = useSearchParams().get("next");
  return async () => {
    await qc.invalidateQueries({ queryKey: ["me"] });
    const me = await api.me();
    qc.setQueryData(["me"], me);
    const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
    const first = me.memberships[0]?.organization.slug;
    router.replace(safeNext ?? (first ? `/o/${first}` : "/onboarding"));
  };
}

export function LoginForm() {
  const after = useAfterAuth();
  const [f, setF] = useState({ email: "", password: "" });
  const m = useMutation({ mutationFn: () => api.login(f), onSuccess: after });
  return (
    <>
      <Head title="Sign in" sub={<>New here? <Link className="text-sapphire hover:underline" href="/register">Create an account</Link></>} />
      <form className="flex flex-col gap-4" onSubmit={(e) => (e.preventDefault(), m.mutate())}>
        <Field label="Email"><Input type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Password"><Input type="password" autoComplete="current-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        {m.error && <ErrorNote error={m.error instanceof ApiError && m.error.status === 401 ? new Error("Email or password is incorrect") : m.error} />}
        <Button variant="primary" type="submit" disabled={m.isPending}>{m.isPending ? "Signing in…" : "Sign in"}</Button>
        <Link href="/forgot" className="text-center text-xs text-muted hover:text-ink">Forgot your password?</Link>
      </form>
    </>
  );
}

export function RegisterForm() {
  const after = useAfterAuth();
  const invited = useSearchParams().get("next")?.startsWith("/invite");
  const [f, setF] = useState({ name: "", email: "", password: "", organizationName: "" });
  const m = useMutation({ mutationFn: () => api.register({ ...f, organizationName: f.organizationName || undefined }), onSuccess: after });
  return (
    <>
      <Head title="Create your account" sub={<>Already registered? <Link className="text-sapphire hover:underline" href="/login">Sign in</Link></>} />
      <form className="flex flex-col gap-4" onSubmit={(e) => (e.preventDefault(), m.mutate())}>
        <Field label="Name"><Input autoComplete="name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Work email"><Input type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Password" hint="At least 12 characters. Long passphrases are best."><Input type="password" autoComplete="new-password" minLength={12} required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        {!invited && <Field label="Organization" hint="Optional — you can create or join one later."><Input value={f.organizationName} onChange={(e) => setF({ ...f, organizationName: e.target.value })} placeholder="Acme Engineering" /></Field>}
        {m.error && <ErrorNote error={m.error} />}
        <Button variant="primary" type="submit" disabled={m.isPending}>{m.isPending ? "Creating…" : "Create account"}</Button>
      </form>
    </>
  );
}

export function ForgotForm() {
  const [email, setEmail] = useState("");
  const m = useMutation({ mutationFn: () => api.resetRequest(email) });
  return (
    <>
      <Head title="Reset password" sub="We will send a single-use link that expires in 30 minutes." />
      {m.isSuccess ? (
        <div className="space-y-3 text-sm">
          <p>If an account exists for <strong>{email}</strong>, a reset link has been sent.</p>
          <p className="text-muted">Local build: no email leaves this machine. Open the <Link className="text-sapphire hover:underline" href={`/mailbox?email=${encodeURIComponent(email)}`}>development mailbox</Link> to follow the link.</p>
        </div>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(e) => (e.preventDefault(), m.mutate())}>
          <Field label="Email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          {m.error && <ErrorNote error={m.error} />}
          <Button variant="primary" type="submit" disabled={m.isPending}>Send reset link</Button>
        </form>
      )}
    </>
  );
}

export function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const [password, setPassword] = useState("");
  const m = useMutation({ mutationFn: () => api.resetConfirm(token, password), onSuccess: () => router.replace("/login") });
  return (
    <>
      <Head title="Choose a new password" sub="All existing sessions will be signed out." />
      <form className="flex flex-col gap-4" onSubmit={(e) => (e.preventDefault(), m.mutate())}>
        <Field label="New password" hint="At least 12 characters."><Input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {!token && <ErrorNote error="This page needs the token from your reset link." />}
        {m.error && <ErrorNote error={m.error} />}
        <Button variant="primary" type="submit" disabled={!token || m.isPending}>Update password</Button>
      </form>
    </>
  );
}
