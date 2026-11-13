import { readFile, readdir, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import Handlebars from "handlebars";

const manifest = JSON.parse(await readFile("module.json", "utf8"));
const pkg = JSON.parse(await readFile("package.json", "utf8"));
if (manifest.version !== pkg.version) throw new Error("Package and manifest versions differ.");
for (const directory of ["scripts", "tools", "tests"]) {
  for (const file of await readdir(directory)) if (file.endsWith(".mjs")) execFileSync(process.execPath, ["--check", `${directory}/${file}`], { stdio: "inherit" });
}
const en = JSON.parse(await readFile("lang/en.json", "utf8"));
const ru = JSON.parse(await readFile("lang/ru.json", "utf8"));
if (JSON.stringify(Object.keys(en).sort()) !== JSON.stringify(Object.keys(ru).sort())) throw new Error("Localization keys differ.");
for (const file of [...manifest.esmodules, ...manifest.styles, ...manifest.languages.map(l => l.path)]) await access(file);
for (const file of await readdir("templates")) {
  const source = await readFile(`templates/${file}`, "utf8");
  Handlebars.precompile(source);
  for (const match of source.matchAll(/localize\s+["']([^"']+)["']/g)) if (!(match[1] in en)) throw new Error(`Untranslated template key: ${match[1]}`);
}
console.log("Syntax, manifest assets, templates and translations validated.");
