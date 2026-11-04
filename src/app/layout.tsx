import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const display = Instrument_Serif({ variable: "--font-display", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  title: "Allowance — spending mandates for AI agents",
  description:
    "Give your AI agent an allowance, not your wallet. Hard spending limits, enforced by code and backed by a PayPal Braintree authorization hold.",
};

function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="6" fill="var(--ink)" />
      <path d="M7 15.5 12 7l5 8.5" stroke="var(--paper)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.8 12.6h6.4" stroke="var(--paper)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} ${display.variable} antialiased min-h-screen`}>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 btn btn-primary">
          Skip to content
        </a>
        <header className="border-b border-line bg-paper/90 backdrop-blur sticky top-0 z-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 h-14 flex items-center gap-4 sm:gap-6">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <Mark />
              <span>Allowance</span>
            </Link>
            <nav className="flex items-center gap-4 text-sm text-ink-2" aria-label="Main">
              <Link href="/" className="hover:text-ink">Mandates</Link>
              <Link href="/ledger" className="hover:text-ink">Audit ledger</Link>
            </nav>
            <div className="ml-auto hidden sm:flex items-center gap-2 text-xs">
              <span className="rounded-full border border-line-2 px-2.5 py-1 text-ink-2">
                Payments: <strong className="text-pay">PayPal Braintree</strong> · sandbox
              </span>
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-6xl px-4 sm:px-6 py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 sm:px-6 pb-10 pt-4 text-xs text-ink-3">
          Sandbox demo. No real money moves. Merchants and products are fictional.
        </footer>
      </body>
    </html>
  );
}
