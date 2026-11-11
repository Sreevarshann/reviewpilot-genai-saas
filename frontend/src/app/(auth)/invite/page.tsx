import type { Metadata } from "next";
import { Suspense } from "react";
import { InviteAccept } from "@/components/Invite";

export const metadata: Metadata = { title: "Invitation" };

export default function Page() {
  return (
    <Suspense>
      <InviteAccept />
    </Suspense>
  );
}
