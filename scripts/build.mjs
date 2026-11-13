// Bundles src/ into plugin/plugin.js: the one self-contained ES module Buzz
// loads. Buzz loads it from a blob URL, so the output must import nothing.
// `--check` fails when plugin/plugin.js is out of date with src/.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = `${root}plugin/plugin.js`;
const check = process.argv.includes("--check");
const { version } = JSON.parse(readFileSync(`${root}package.json`, "utf8"));

const result = await build({
  entryPoints: [`${root}src/index.js`],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  // Classic JSX: Buzz gives plugins React through ctx.react, not an import.
  jsx: "transform",
  jsxFactory: "h",
  jsxFragment: "Fragment",
  loader: { ".png": "dataurl", ".svg": "dataurl" },
  define: { __VERSION__: JSON.stringify(version) },
  legalComments: "none",
  minify: false,
  write: false,
  banner: {
    js: `// Claude (ACP) for Buzz ${version}. Built from src/ by scripts/build.mjs; edit the sources, not this file.`,
  },
});

const code = result.outputFiles[0].text;
// A bare or relative import would fail when Buzz loads the module.
if (/^\s*import\s|\bimport\s*\(/m.test(code)) {
  console.error("plugin.js must not import anything");
  process.exit(1);
}
if (check) {
  let current = "";
  try {
    current = readFileSync(out, "utf8");
  } catch {
    // Missing counts as stale.
  }
  if (current !== code) {
    console.error("plugin/plugin.js is out of date: run npm run build");
    process.exit(1);
  }
  console.log("plugin/plugin.js is up to date");
} else {
  writeFileSync(out, code);
  console.log(`wrote plugin/plugin.js (${(code.length / 1024).toFixed(1)} KB)`);
}
