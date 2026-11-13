import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { unzipSync, strFromU8 } from "fflate";

test("manifest allows Foundry 13.347+ and D&D5e 5.3.3 without missing registered assets", async () => {
  const manifest = JSON.parse(await readFile("module.json", "utf8"));
  assert.equal(manifest.id, "silverlane-resource-bars");
  assert.equal(manifest.compatibility.minimum, "13.347");
  assert.equal(manifest.relationships.systems[0].id, "dnd5e");
  assert.equal(manifest.relationships.systems[0].compatibility.minimum, "5.3.3");
  for (const file of [...manifest.esmodules, ...manifest.styles, ...manifest.languages.map(l => l.path)]) await access(file);
});

test("Russian and English localization keys are identical and nonempty", async () => {
  const en = JSON.parse(await readFile("lang/en.json", "utf8"));
  const ru = JSON.parse(await readFile("lang/ru.json", "utf8"));
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ru).sort());
  assert.ok(Object.keys(en).length >= 40);
  assert.ok(Object.values(ru).every(value => typeof value === "string" && value.length > 0));
});

test("build emits an installable zip without dev dependencies or git metadata", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "silverlane-package-"));
  try {
    const out = path.join(directory, "module.zip");
    await promisify(execFile)(process.execPath, ["tools/build.mjs", "--out", out]);
    const zip = unzipSync(await readFile(out));
    assert.ok(zip["module.json"]);
    assert.ok(zip["scripts/main.mjs"]);
    assert.ok(zip["templates/tracker.hbs"]);
    assert.equal(Object.keys(zip).some(name => /node_modules|\.git\/|tests\//.test(name)), false);
    assert.equal(JSON.parse(strFromU8(zip["module.json"])).id, "silverlane-resource-bars");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
