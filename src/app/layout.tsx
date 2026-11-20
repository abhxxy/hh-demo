import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Home & Hill — Guest Portal & Staff Dashboard",
  description: "Home & Hill short-stay apartments (Belgium) — demo guest portal, AI concierge and staff dashboard. Test environment.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-stone-50 text-stone-900">
        <div className="flex-1 flex flex-col">{children}</div>
        {/* "Test environment" badge on every page */}
        <div className="fixed bottom-3 right-3 z-50 pointer-events-none">
          <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 border border-amber-300 px-2.5 py-1 text-[11px] font-semibold tracking-wide">
            Test environment
          </span>
        </div>
      </body>
    </html>
  );
}
