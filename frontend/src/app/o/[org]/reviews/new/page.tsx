import type { Metadata } from "next";
import { NewReview } from "@/components/NewReview";

export const metadata: Metadata = { title: "New review" };

// Authenticated, client-fetched view (see ../layout.tsx).
export const instant = false;

export default function Page() {
  return <NewReview />;
}
