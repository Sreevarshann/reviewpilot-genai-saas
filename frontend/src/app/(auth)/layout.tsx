import { Logo } from "@/components/Logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,560px)]">
      <section className="relative hidden overflow-hidden border-r border-line bg-panel-2 p-12 lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-2.5">
          <Logo />
          <span className="font-display text-lg font-semibold">ReviewPilot</span>
        </div>
        <div className="max-w-lg">
          <h2 className="font-display text-4xl font-semibold leading-tight">Code review that shows its evidence.</h2>
          <p className="mt-4 text-muted">Deterministic checks and a local model review every diff. Each model finding must quote the exact lines it cites, or it is discarded.</p>
          <ul className="mt-8 space-y-3 text-sm">
            {["Grounded findings with line-level evidence", "Tenant-isolated organizations, roles and audit log", "Usage metering against plan limits — no payments collected"].map((t) => (
              <li key={t} className="flex items-center gap-2.5">
                <span className="size-1.5 rounded-full bg-copper" />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-muted">Local portfolio build · Ollama qwen3:4b-instruct by default</p>
      </section>
      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">{children}</div>
      </section>
    </main>
  );
}
