import { Suspense } from "react";
import { Shell } from "@/components/Shell";

// Organization pages are authenticated, per-user views fetched on the client; there is no
// shared static shell worth prerendering, so each page opts out of instant-navigation
// validation (`export const instant = false`).
export default function OrgLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
