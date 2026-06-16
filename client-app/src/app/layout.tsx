import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { LocaleProvider } from "@/i18n/LocaleProvider";
import { ThemeProvider } from "@/lib/providers/ThemeProvider";
import { Toaster } from "@/components/Toaster";

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
  title: "Drivers-For-U | Unified Dispatch Platform",
  description:
    "High-performance, secure dynamic ride dispatch matching ecosystem client application.",
  verification: {
    google: "dg6nUxvK7dY9xv1e0v2abZSJ8P0TnQBL59avWsb65q4",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background-primary text-content-primary">
        <LocaleProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </LocaleProvider>
        <Toaster />
      </body>
    </html>
  );
}
