import type { Metadata } from "next";
import { Analytics } from "@/components/Analytics";

export const metadata: Metadata = { title: "Analytics" };

// Authenticated, client-fetched view (see ../layout.tsx).
export const instant = false;

export default function Page() {
  return <Analytics />;
}
