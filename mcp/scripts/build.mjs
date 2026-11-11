import { chmod } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [join(pkg, "src/server.ts")],
  outfile: join(pkg, "dist/server.js"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  banner: { js: "#!/usr/bin/env node" },
  alias: { "@authab/sdk": resolve(pkg, "../sdk/src/index.ts") },
  sourcemap: false,
  logLevel: "info",
});

await chmod(join(pkg, "dist/server.js"), 0o755).catch(() => null);
