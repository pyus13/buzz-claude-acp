// Builds the files a GitHub release attaches, into dist/:
//
//   claude-acp-<version>.plugin.json  the one-file artifact for Buzz's
//                                     "Add from URL" (with its SHA-256)
//   buzz-claude-acp-<version>.zip     plugin/ and the adapter installer
//   SHA256SUMS                        checksums of both
//   RELEASE_NOTES.md                  this version's notes from CHANGELOG.md
//
// It refuses to release a stale build or failing tests, and checks the
// limits Buzz enforces on install, so a release installs everywhere.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const at = (path) => `${root}${path}`;
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: "inherit" });
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message) => {
  console.error(`release: ${message}`);
  process.exit(1);
};

const { version } = JSON.parse(readFileSync(at("package.json"), "utf8"));

// 1. The build matches src/, and the tests pass.
run("node", ["scripts/build.mjs", "--check"]);
if (!process.argv.includes("--skip-tests")) run("npx", ["vitest", "run"]);

// 2. The plugin as Buzz installs it, within Buzz's limits.
const manifestText = readFileSync(at("plugin/manifest.json"), "utf8");
const manifest = JSON.parse(manifestText);
const code = readFileSync(at("plugin/plugin.js"), "utf8");
const readme = readFileSync(at("plugin/README.md"), "utf8");
const icon = readFileSync(at("plugin/icon.png"));
const allowed = new Set(["id", "name", "apiVersion", "description", "discovery", "host"]);
for (const key of Object.keys(manifest)) if (!allowed.has(key)) fail(`manifest.json has a key Buzz rejects: ${key}`);
if (manifest.apiVersion !== 1) fail("manifest.json apiVersion must be 1");
if (Buffer.byteLength(readme) > 256 * 1024) fail("plugin/README.md exceeds Buzz's 256 KiB");
if (icon.length > 1024 * 1024) fail("plugin/icon.png exceeds Buzz's 1 MiB");
if (!icon.subarray(1, 4).equals(Buffer.from("PNG"))) fail("plugin/icon.png is not a PNG");
if (/^\s*import\s|\bimport\s*\(/m.test(code)) fail("plugin.js must not import anything");

// 3. The release files.
const dist = at("dist/");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
const artifact = Buffer.from(
  JSON.stringify({ manifest, code, readme, iconPng: icon.toString("base64") }),
);
if (artifact.length > 8 * 1024 * 1024) fail("the artifact exceeds Buzz's 8 MiB");
const artifactName = `claude-acp-${version}.plugin.json`;
writeFileSync(`${dist}${artifactName}`, artifact);

const zipName = `buzz-claude-acp-${version}.zip`;
run("zip", [
  "-q",
  "-X",
  `dist/${zipName}`,
  "plugin/manifest.json",
  "plugin/plugin.js",
  "plugin/icon.png",
  "plugin/README.md",
  "scripts/install-adapter.sh",
  "README.md",
  "LICENSE",
]);

const sums = [artifactName, zipName].map((name) => `${sha256(readFileSync(`${dist}${name}`))}  ${name}`);
writeFileSync(`${dist}SHA256SUMS`, `${sums.join("\n")}\n`);

const changelog = readFileSync(at("CHANGELOG.md"), "utf8");
const section = changelog.match(new RegExp(`^## ${version.replaceAll(".", "\\.")}\\b[^\\n]*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m"));
if (!section) fail(`CHANGELOG.md has no "## ${version}" section`);
const artifactSum = sums[0].split("  ")[0];
writeFileSync(
  `${dist}RELEASE_NOTES.md`,
  `${section[1].trim()}

## Install

- **From GitHub, in Buzz:** Settings → Plugins → Manage plugins → Add → *Git or GitHub repository*: this repository, tag \`v${version}\`, folder \`plugin\`.
- **From this release, in Buzz:** *Add from URL* with the \`${artifactName}\` asset's link and SHA-256 \`${artifactSum}\`.
- **From a folder:** unzip \`${zipName}\` and choose its \`plugin\` folder with *Browse*.

Then install the adapter once: \`sh scripts/install-adapter.sh\` (in the zip, or this repository).
`,
);

for (const name of [artifactName, zipName]) console.log(`dist/${name}  ${(statSync(`${dist}${name}`).size / 1024).toFixed(1)} KB`);
console.log(`\n${artifactName} SHA-256: ${artifactSum}`);
console.log(`\nPublish: git tag v${version} && git push origin v${version}; the Release workflow publishes dist/.`);
