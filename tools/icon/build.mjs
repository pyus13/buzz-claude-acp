// Draws the plugin's two icons from their sources:
//   src/assets/harness-mark.svg  beside "Claude (ACP)" in the Harness picker
//   plugin/icon.png              the Settings → Plugins tile
// `npm run icons -- --check` fails if a committed icon differs.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { harnessMark } from "./harness-mark.mjs";
import { tile } from "./list-tile.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const check = process.argv.includes("--check");
const outputs = [
  ["src/assets/harness-mark.svg", Buffer.from(harnessMark())],
  ["plugin/icon.png", Buffer.from(new Resvg(tile).render().asPng())],
];

let stale = false;
for (const [path, bytes] of outputs) {
  if (!check) {
    writeFileSync(`${root}${path}`, bytes);
    console.log(`wrote ${path}`);
  } else if (!readFileSync(`${root}${path}`).equals(bytes)) {
    console.error(`${path} differs from its source`);
    stale = true;
  }
}
if (stale) process.exit(1);
if (check) console.log("icons match their sources");
