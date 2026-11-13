import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID } from "../scripts/domain.mjs";

const hooks = new Map();
const settings = new Map();
const registrations = new Map();
globalThis.Hooks = {
  once(name, fn) { hooks.set(name, fn); },
  on(name, fn) { hooks.set(name, fn); }
};
globalThis.foundry = {
  applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: Base => Base } },
  documents: { ActiveEffect: { async fromStatusEffect(status) { return { toObject: () => ({ type: "condition", statuses: [status] }) }; } } }
};
globalThis.game = {
  user: { id: "gm", isGM: true }, users: { activeGM: { id: "gm" } },
  system: { id: "dnd5e", version: "6.1.0" },
  modules: new Map([[MODULE_ID, {}]]),
  settings: {
    register(scope, key, config) { settings.set(key, config.default); registrations.set(key, config); },
    registerMenu(scope, key, config) { registrations.set(key, config); },
    get(scope, key) { return settings.get(key); }
  },
  keybindings: { register() {} }, i18n: { localize: key => key }
};
globalThis.canvas = { ready: false };
await import("../scripts/main.mjs");

test("Foundry init registers world schema, settings menu, and documented module API", async () => {
  await hooks.get("init")();
  const api = game.modules.get(MODULE_ID).api;
  for (const method of ["open", "configure", "configureItem", "get", "set", "adjust", "reset", "applyItem", "applyOnHit"]) assert.equal(typeof api[method], "function");
  assert.equal(registrations.get("definitions").scope, "world");
  assert.equal(registrations.get("resourceConfig").restricted, true);
  assert.equal(settings.get("definitions")[0].thresholds[1].status, "paralyzed");
});

test("combat hooks are registered for v14 messages, native damage and optional Midi-QOL", () => {
  for (const hook of ["createChatMessage", "updateChatMessage", "dnd5e.applyDamage", "midi-qol.RollComplete", "refreshToken", "renderApplicationV2"]) assert.equal(typeof hooks.get(hook), "function");
});
