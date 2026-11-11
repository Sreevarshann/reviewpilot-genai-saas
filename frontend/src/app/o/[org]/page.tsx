import type { Metadata } from "next";
import { ReviewsDashboard } from "@/components/Reviews";

export const metadata: Metadata = { title: "Reviews" };

// Authenticated, client-fetched view (see ../layout.tsx).
export const instant = false;

export default function Page() {
  return <ReviewsDashboard />;
}
