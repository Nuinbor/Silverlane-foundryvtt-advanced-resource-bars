import { readFile, readdir, stat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, "module.json"), "utf8"));
const outputIndex = process.argv.indexOf("--out");
const output = path.resolve(outputIndex >= 0 ? process.argv[outputIndex + 1] : path.join(root, "dist/silverlane-resource-bars.zip"));
const entries = {};
async function include(relative) {
  const absolute = path.join(root, relative);
  if ((await stat(absolute)).isDirectory()) {
    for (const child of (await readdir(absolute)).sort()) await include(`${relative}/${child}`);
  } else entries[relative] = [new Uint8Array(await readFile(absolute)), { mtime: new Date("2026-01-01T00:00:00Z") }];
}
for (const relative of ["module.json", "LICENSE", "README.md", "scripts", "templates", "styles", "lang", "macros"]) await include(relative);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, zipSync(entries, { level: 9 }));
await writeFile(path.join(path.dirname(output), "module.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built ${output} (${Object.keys(entries).length} files, v${manifest.version})`);
