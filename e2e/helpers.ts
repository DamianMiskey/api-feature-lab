import type { Page } from "@playwright/test";
import { features } from "@/lib/features";

export const PAGES = ["/", ...features.filter((f) => f.ready).map((f) => `/${f.slug}`)];

/** Collects uncaught exceptions, console errors (CSP violations included) and failed requests. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`exception: ${e.message}`));
  page.on("response", (r) => {
    if (r.status() >= 400) errors.push(`${r.status()}: ${new URL(r.url()).pathname}`);
  });
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(`console: ${m.text()}`);
  });
  return errors;
}

/**
 * How far the page is wider than the device. Not scrollWidth - innerWidth:
 * on a phone the browser widens its layout viewport to fit too-wide content,
 * which would hide the very overflow being measured.
 */
export async function overflow(page: Page) {
  const width = page.viewportSize()!.width;
  return (await page.evaluate(() => document.documentElement.scrollWidth)) - width;
}
