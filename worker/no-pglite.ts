// Stands in for @electric-sql/pglite in the Worker bundle (see "alias" in
// wrangler.jsonc). The Worker always has DATABASE_URL, so the in-memory
// database is never used there, and its WebAssembly doesn't need shipping.
export class PGlite {
  constructor() {
    throw new Error("PGlite isn't available in the Worker: set DATABASE_URL.");
  }
}
export const types = {};
