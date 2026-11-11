import type { Metadata } from "next";
import { Suspense } from "react";
import { Mailbox } from "@/components/Invite";

export const metadata: Metadata = { title: "Development mailbox" };

export default function Page() {
  return (
    <Suspense>
      <Mailbox />
    </Suspense>
  );
}
