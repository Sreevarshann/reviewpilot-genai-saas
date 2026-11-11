import type { Metadata } from "next";
import { Suspense } from "react";
import { Onboarding } from "@/components/Invite";

export const metadata: Metadata = { title: "Create organization" };

export default function Page() {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="w-full max-w-sm">
        <Suspense>
          <Onboarding />
        </Suspense>
      </div>
    </main>
  );
}
