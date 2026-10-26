import type { Metadata } from "next";
import { THEME_SCRIPT } from "@djmiskey/lab-tokens/theme";
import { Nav } from "@/components/Nav";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "API Feature Lab", template: "%s · API Feature Lab" },
  description: "Backend API design, one technique per page: each with a live endpoint, an explanation and the code.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: the theme script sets data-theme before React loads.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the visitor's theme before the first paint, so there's no flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {/* minmax(0, 1fr), not 1fr: a column sized to its content would let a
            wide code block or response widen the whole page on a phone. */}
        <div className="grid min-h-screen grid-cols-[minmax(0,1fr)] md:grid-cols-[240px_minmax(0,1fr)]">
          <Nav />
          <main className="w-full min-w-0 max-w-250 px-[clamp(16px,4vw,3rem)] py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
