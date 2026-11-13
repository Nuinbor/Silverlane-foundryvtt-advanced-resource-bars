import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID } from "../scripts/domain.mjs";
import { Window } from "happy-dom";
import { actorFixture, stateOf } from "./helpers.mjs";

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
  for (const method of ["open", "openManager", "configure", "configureItem", "get", "set", "adjust", "reset", "applyItem", "applyOnHit", "removeEffect", "retryActions"]) assert.equal(typeof api[method], "function");
  assert.equal(registrations.get("definitions").scope, "world");
  assert.equal(registrations.get("resourceConfig").restricted, true);
  assert.equal(registrations.get("manager").restricted, true);
  assert.equal(settings.get("definitions")[0].thresholds[1].status, "paralyzed");
});

test("GM scene controls expose the resource manager and register atomic native-damage markers", () => {
  assert.equal(typeof hooks.get("dnd5e.preApplyDamage"), "function");
  const controls = { tokens: { tools: {} } };
  hooks.get("getSceneControlButtons")(controls);
  assert.equal(controls.tokens.tools[MODULE_ID].button, true);
  assert.equal(typeof controls.tokens.tools[MODULE_ID].onChange, "function");
  game.user.isGM = false;
  const playerControls = { tokens: { tools: {} } };
  hooks.get("getSceneControlButtons")(playerControls);
  assert.deepEqual(playerControls.tokens.tools, {});
  game.user.isGM = true;
});

test("manager opened through module settings refreshes after combat changes too", () => {
  const Manager = registrations.get("manager").type;
  const app = new Manager();
  app.rendered = true;
  let renders = 0;
  app.render = () => { renders++; };
  hooks.get("updateActor")();
  assert.equal(renders, 1);
  app.rendered = false;
});

test("combat hooks are registered for v14 messages, native damage and optional Midi-QOL", () => {
  for (const hook of ["createChatMessage", "updateChatMessage", "dnd5e.applyDamage", "midi-qol.RollComplete", "refreshToken", "renderApplicationV2"]) assert.equal(typeof hooks.get(hook), "function");
});

test("manager follows token selection, scene changes and token creation/removal", () => {
  const Manager = registrations.get("manager").type;
  const app = new Manager();
  app.rendered = true;
  let renders = 0;
  app.render = () => { renders++; };
  try {
    for (const hook of ["controlToken", "canvasReady", "createToken", "deleteToken"]) {
      const before = renders;
      hooks.get(hook)?.();
      assert.equal(renders, before + 1, hook);
    }
  } finally { app.rendered = false; }
});

test("sheet actions attach to the outer frame when v14 hooks provide inner content", () => {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  const frame = document.createElement("section");
  frame.innerHTML = '<header class="window-header"><button data-action="close">X</button></header><div class="window-content"></div>';
  const app = { document: { documentName: "Actor", isOwner: true }, element: frame };
  hooks.get("renderApplicationV2")(app, frame.querySelector(".window-content"));
  assert.equal(frame.querySelectorAll(".window-header .srb-sheet-button").length, 1);
  hooks.get("renderApplicationV2")(app, frame.querySelector(".window-content"));
  assert.equal(frame.querySelectorAll(".window-header .srb-sheet-button").length, 1);
});

for (const generation of [13, 14]) test(`module API preserves D&D5e 5.3.3 system statuses on Foundry ${generation}`, async () => {
  game.release = { generation };
  game.system.version = "5.3.3";
  globalThis.CONFIG = { ActiveEffect: { documentClass: {
    async fromStatusEffect(status) {
      assert.equal(status, "paralyzed");
      return { toObject: () => ({ type: "base", statuses: ["paralyzed", "incapacitated"],
        ...(generation < 14 ? { changes: [] } : { system: { changes: [] } }) }) };
    }
  } } };
  const actor = actorFixture();
  try {
    await game.modules.get(MODULE_ID).api.set(actor, "nerve-damage", 100);
    assert.equal(stateOf(actor).value, 0);
    assert.deepEqual(actor.effects[0].statuses, ["paralyzed", "incapacitated"]);
    assert.ok(Array.isArray(generation < 14 ? actor.effects[0].changes : actor.effects[0].system.changes));
    if (generation < 14) assert.equal(actor.effects[0].system?.changes, undefined);
    else assert.equal(actor.effects[0].changes, undefined);
  } finally {
    delete game.release;
    game.system.version = "6.1.0";
    delete globalThis.CONFIG;
  }
});

test("Foundry 14 / D&D5e 5.3.3 handles a legacy monster attack through registered chat hooks", async () => {
  game.release = { generation: 14 };
  game.system.version = "5.3.3";
  globalThis.CONFIG = { ActiveEffect: { documentClass: { async fromStatusEffect() {
    return { toObject: () => ({ type: "base", statuses: ["paralyzed", "incapacitated"], system: { changes: [] } }) };
  } } } };
  const actor = actorFixture();
  globalThis.fromUuid = async uuid => uuid === actor.uuid ? actor : null;
  const message = {
    uuid: "ChatMessage.legacy533", type: "base", author: game.user,
    rolls: [{ total: 20, isCritical: false, isFumble: false }], system: {},
    flags: { dnd5e: { roll: { type: "attack" }, targets: [{ uuid: actor.uuid, ac: 15 }] } },
    getAssociatedItem: () => ({ getFlag: () => [{ resourceId: "nerve-damage", amount: 5, trigger: "hit" }] }),
    getAssociatedActivity: () => ({ id: "bite" })
  };
  try {
    await game.modules.get(MODULE_ID).api.set(actor, "nerve-damage", 95);
    await hooks.get("createChatMessage")(message);
    await hooks.get("updateChatMessage")(message);
    assert.equal(stateOf(actor).value, 0);
    assert.equal(stateOf(actor).cycles, 1);
    assert.equal(actor.effects.length, 1);
    assert.deepEqual(actor.effects[0].statuses, ["paralyzed", "incapacitated"]);
    assert.ok(Array.isArray(actor.effects[0].system.changes));
  } finally {
    delete game.release;
    game.system.version = "6.1.0";
    delete globalThis.CONFIG;
    delete globalThis.fromUuid;
  }
});
