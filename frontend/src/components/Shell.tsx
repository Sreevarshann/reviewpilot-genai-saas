"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, ChevronsUpDown, FileDiff, LogOut, Moon, Plus, Settings, Sun } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useMe } from "@/lib/session";
import type { Me, Org } from "@/lib/types";
import { Logo } from "./Logo";
import { useTheme } from "./theme";
import { Chip, ErrorNote, Skeleton } from "./ui";

const OrgCtx = createContext<{ org: Org; me: Me } | null>(null);
export function useOrg() {
  const v = useContext(OrgCtx);
  if (!v) throw new Error("useOrg outside Shell");
  return v;
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { org: slug } = useParams<{ org: string }>();
  const me = useMe();
  const router = useRouter();
  const path = usePathname();
  const org = useQuery({ queryKey: ["org", slug], queryFn: () => api.org(slug), enabled: !!me.data });
  useEffect(() => {
    if (me.data === null) router.replace(`/login?next=${encodeURIComponent(path)}`);
  }, [me.data, router, path]);

  if (me.isPending || (me.data && org.isPending)) return <Loading />;
  if (me.error) return <Centered><ErrorNote error={me.error} /></Centered>;
  if (!me.data) return <Loading />;
  if (org.error)
    return (
      <Centered>
        <h1 className="font-display text-xl font-semibold">{org.error instanceof ApiError && org.error.status === 404 ? "Organization not found" : "Could not load organization"}</h1>
        <p className="mt-2 text-sm text-muted">{org.error instanceof ApiError && org.error.status === 404 ? "It does not exist, or you are not a member." : org.error.message}</p>
        <Link href="/" className="mt-4 inline-block text-sm text-sapphire hover:underline">Go to my organizations</Link>
      </Centered>
    );
  return (
    <OrgCtx.Provider value={{ org: org.data!, me: me.data }}>
      <div className="flex min-h-dvh">
        <Sidebar org={org.data!} me={me.data} />
        <div className="min-w-0 flex-1">
          <MobileNav org={org.data!} />
          <main className="px-4 py-6 sm:px-8 lg:px-10">{children}</main>
        </div>
      </div>
    </OrgCtx.Provider>
  );
}

function useNav(org: Org) {
  const path = usePathname();
  const base = `/o/${org.slug}`;
  return [
    { href: base, label: "Reviews", icon: FileDiff, active: path === base || (path.startsWith(`${base}/reviews`) && !path.endsWith("/new")) },
    { href: `${base}/reviews/new`, label: "New review", icon: Plus, active: path.endsWith("/reviews/new") },
    { href: `${base}/analytics`, label: "Analytics", icon: BarChart3, active: path.startsWith(`${base}/analytics`) },
    { href: `${base}/settings`, label: "Organization", icon: Settings, active: path.startsWith(`${base}/settings`) },
  ];
}

function MobileNav({ org }: { org: Org }) {
  const nav = useNav(org);
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-panel md:hidden">
      <div className="flex items-center gap-2 px-4 pt-3">
        <Logo className="size-6" />
        <span className="truncate text-sm font-semibold">{org.name}</span>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-2 pb-2 pt-2" aria-label="Main">
        {nav.map((n) => (
          <Link key={n.href} href={n.href} aria-current={n.active ? "page" : undefined} className={cn("flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs", n.active ? "bg-sapphire-soft font-medium text-sapphire" : "text-muted")}>
            <n.icon className="size-3.5" />
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

function Sidebar({ org, me }: { org: Org; me: Me }) {
  const nav = useNav(org);
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-panel md:flex">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <Logo />
        <span className="font-display text-base font-semibold">ReviewPilot</span>
      </div>
      <OrgSwitcher org={org} me={me} />
      <nav className="mt-4 flex flex-col gap-0.5 px-3" aria-label="Main">
        {nav.map((n) => (
          <Link key={n.href} href={n.href} aria-current={n.active ? "page" : undefined} className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm", n.active ? "bg-sapphire-soft font-medium text-sapphire" : "text-muted hover:bg-panel-2 hover:text-ink")}>
            <n.icon className="size-4" />
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="mt-auto border-t border-line p-3">
        <UserBox me={me} />
      </div>
    </aside>
  );
}

function OrgSwitcher({ org, me }: { org: Org; me: Me }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative px-3">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="listbox" className="flex w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-left hover:bg-panel-2">
        <span className="grid size-6 place-items-center rounded-md bg-copper-soft text-xs font-semibold text-copper">{org.name[0]?.toUpperCase()}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{org.name}</span>
          <span className="block text-[11px] text-muted">{org.limits.label} · {org.role.toLowerCase()}</span>
        </span>
        <ChevronsUpDown className="size-3.5 text-muted" />
      </button>
      {open && (
        <div role="listbox" className="absolute inset-x-3 top-full z-20 mt-1 rounded-lg border border-line bg-panel p-1 shadow-lg">
          {me.memberships.map((m) => (
            <Link key={m.organization.id} href={`/o/${m.organization.slug}`} onClick={() => setOpen(false)} role="option" aria-selected={m.organization.slug === org.slug} className="flex items-center justify-between rounded-md px-2.5 py-2 text-sm hover:bg-panel-2">
              <span className="truncate">{m.organization.name}</span>
              <Chip>{m.role.toLowerCase()}</Chip>
            </Link>
          ))}
          <Link href="/onboarding" className="mt-1 flex items-center gap-2 rounded-md border-t border-line px-2.5 py-2 text-sm text-muted hover:bg-panel-2">
            <Plus className="size-3.5" /> New organization
          </Link>
        </div>
      )}
    </div>
  );
}

function UserBox({ me }: { me: Me }) {
  const { theme, toggle } = useTheme();
  const qc = useQueryClient();
  const router = useRouter();
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1 px-1">
        <div className="truncate text-sm font-medium">{me.name}</div>
        <div className="truncate text-[11px] text-muted">{me.email}</div>
      </div>
      <button onClick={toggle} className="rounded-md p-2 text-muted hover:bg-panel-2 hover:text-ink" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
        {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </button>
      <button
        onClick={async () => {
          await api.logout().catch(() => undefined);
          qc.clear();
          router.replace("/login");
        }}
        className="rounded-md p-2 text-muted hover:bg-panel-2 hover:text-ink"
        aria-label="Sign out"
      >
        <LogOut className="size-4" />
      </button>
    </div>
  );
}

const Centered = ({ children }: { children: React.ReactNode }) => <main className="grid min-h-dvh place-items-center p-6"><div className="max-w-md text-center">{children}</div></main>;
const Loading = () => (
  <div className="flex min-h-dvh">
    <div className="hidden w-60 border-r border-line bg-panel md:block" />
    <div className="flex-1 space-y-4 p-10">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-40 w-full" />
    </div>
  </div>
);
