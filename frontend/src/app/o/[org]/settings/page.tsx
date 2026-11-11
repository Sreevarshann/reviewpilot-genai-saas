import type { Metadata } from "next";
import { Settings } from "@/components/Settings";

export const metadata: Metadata = { title: "Organization" };

// Authenticated, client-fetched view (see ../layout.tsx).
export const instant = false;

export default function Page() {
  return <Settings />;
}
