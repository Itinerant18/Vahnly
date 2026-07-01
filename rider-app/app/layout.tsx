import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono, Geist } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/lib/providers/ThemeProvider";
import { Toaster } from "@/components/Toaster";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});


// ── Inter — display, body, labels ──────────────────────────────────────────
// RULE: Inter for ALL prose, headings, labels, addresses, phone numbers.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

// ── JetBrains Mono — fares, ETAs, distances, IDs ONLY ─────────────────────
// RULE: Never use font-mono for addresses or phone numbers.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Vahnly",
  description: "Hire a professional driver for your own car.",
  verification: {
    google: "dg6nUxvK7dY9xv1e0v2abZSJ8P0TnQBL59avWsb65q4",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // Rider app: light mode default (white background)
  themeColor: "#FFFFFF",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="light"
      className={cn(inter.variable, jetbrainsMono.variable, "font-sans", geist.variable)}
      suppressHydrationWarning
    >
      <body
        className="bg-background-primary text-content-primary"
        suppressHydrationWarning
      >
        <ThemeProvider>{children}</ThemeProvider>
        <Toaster />
      </body>
    </html>
  );
}
