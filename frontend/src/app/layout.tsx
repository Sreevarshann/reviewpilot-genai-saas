import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import Script from "next/script";
import { Providers } from "@/components/Providers";
import { themeInitScript } from "@/components/theme";
import "./globals.css";

const head = Space_Grotesk({ variable: "--font-head", subsets: ["latin"] });
const body = Inter({ variable: "--font-body", subsets: ["latin"] });
const code = JetBrains_Mono({ variable: "--font-code", subsets: ["latin"] });

export const metadata: Metadata = { title: { default: "ReviewPilot", template: "%s · ReviewPilot" }, description: "Grounded AI code review for teams." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning className={`${head.variable} ${body.variable} ${code.variable}`}>
      <body className="min-h-dvh">
        <Script id="theme" strategy="beforeInteractive">{themeInitScript}</Script>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
