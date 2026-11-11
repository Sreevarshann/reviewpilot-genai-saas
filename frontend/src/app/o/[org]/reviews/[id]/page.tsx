import type { Metadata } from "next";
import { ReviewDetail } from "@/components/ReviewDetail";

export const metadata: Metadata = { title: "Review" };

// Authenticated, client-fetched view (see ../layout.tsx).
export const instant = false;

export default function Page() {
  return <ReviewDetail />;
}
