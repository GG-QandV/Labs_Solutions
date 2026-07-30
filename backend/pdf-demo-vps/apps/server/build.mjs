// Bundle server + workspace TS packages into one JS file; keep native/heavy deps external.
import { build } from "esbuild";
await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist/server.js",
  external: ["fastify", "@fastify/*", "better-sqlite3", "playwright-core"],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" }
});
console.log("bundled -> dist/server.js");
