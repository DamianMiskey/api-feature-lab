import { cacheLife } from "next/cache";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Read a source file once and cache the result (Cache Components). It runs at
// build time, so the code is baked into the prerendered HTML and the function
// bundle doesn't need the source files.
// Paths are relative to src/ so the file access is statically scoped: only
// src/ gets traced into the deployment, not the whole project. (A page may
// reach outside with "../", e.g. the Worker's files: that works because the
// read happens at build time, when the whole project is there.)
// Source can't change within a deployment, so it's cached for the longest
// life ("max"); a shorter one would cap the life of every page that uses it.
async function readSource(file: string) {
  "use cache";
  cacheLife("max");
  return readFile(path.join(process.cwd(), "src", file), "utf8");
}

// Shows the source file behind a demo. Unlike the Cloudflare lab (Vite `?raw`
// imports), a Server Component can simply read the file.
export async function CodePeek({ file }: { file: string }) {
  const source = await readSource(file);
  return (
    <details className="group my-6 [&+&]:-mt-3">
      <summary className="inline-block cursor-pointer list-none rounded-md border border-line px-3.5 py-1.5 font-medium text-accent-ink group-open:mb-1 [&::-webkit-details-marker]:hidden">
        Show code · <code>{path.posix.normalize(`src/${file}`)}</code>
      </summary>
      <pre tabIndex={0} className="mt-3 max-h-120 overflow-x-auto rounded-lg bg-code px-4 py-3.5 font-mono text-[12.5px] leading-normal">{source}</pre>
    </details>
  );
}
