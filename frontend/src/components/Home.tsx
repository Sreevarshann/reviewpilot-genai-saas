"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useMe } from "@/lib/session";
import { Skeleton } from "./ui";

/** Routes to the user's first organization, onboarding, or sign-in. */
export function Home() {
  const me = useMe();
  const router = useRouter();
  useEffect(() => {
    if (me.data === null) router.replace("/login");
    else if (me.data) router.replace(me.data.memberships[0] ? `/o/${me.data.memberships[0].organization.slug}` : "/onboarding");
  }, [me.data, router]);
  return (
    <main className="grid min-h-dvh place-items-center">
      <Skeleton className="h-6 w-48" />
    </main>
  );
}
