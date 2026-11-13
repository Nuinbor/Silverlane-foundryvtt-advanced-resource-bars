import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Handlebars from "handlebars";
import { Window } from "happy-dom";
import { ResourceService } from "../scripts/service.mjs";
import { MODULE_ID, defaultDefinitions } from "../scripts/domain.mjs";
import { actorFixture, stateOf, statusFixture } from "./helpers.mjs";

globalThis.foundry = { applications: { api: { ApplicationV2: class { constructor(options) { this.options = options; } }, HandlebarsApplicationMixin: Base => Base } } };
const { managerActors, ResourceManager } = await import("../scripts/manager.mjs");

test("manager scopes preserve synthetic Actors, deduplicate linked Actors and exclude unowned targets", () => {
  const hero = actorFixture(); hero.type = "character";
  const synthetic = actorFixture({ uuid: "Scene.scene.Token.test.Actor.hero" });
  const foreign = actorFixture({ owner: false }); foreign.type = "character";
  const game = { actors: [hero, foreign] };
  const canvas = { tokens: { placeables: [{ actor: hero }, { actor: hero }, { actor: synthetic }, { actor: foreign }], controlled: [{ actor: synthetic }] } };
  assert.deepEqual(managerActors(game, canvas, "characters"), [hero]);
  assert.deepEqual(managerActors(game, canvas, "scene"), [hero, synthetic]);
  assert.deepEqual(managerActors(game, canvas, "selected"), [synthetic]);
});

test("manager renders editable resource cells, managed effects and quick new/edit controls", async () => {
  const actor = actorFixture(); actor.type = "character";
  const service = new ResourceService({ definitions: defaultDefinitions, statusEffect: statusFixture, resolve: async uuid => uuid === actor.uuid ? actor : null });
  await service.set(actor, "nerve-damage", 100);
  globalThis.game = { user: { isGM: true }, actors: [actor], i18n: { localize: key => key }, modules: new Map([[MODULE_ID, { api: service }]]) };
  globalThis.CONFIG = { statusEffects: [{ id: "paralyzed", name: "Paralyzed" }] };
  const app = new ResourceManager({ service });
  const context = await app._prepareContext();
  Handlebars.registerHelper("localize", key => key);
  const form = new Window().document.createElement("section");
  form.innerHTML = Handlebars.compile(await readFile("templates/manager.hbs", "utf8"))(context);
  assert.equal(form.querySelector('[data-edit-value]').value, "0");
  assert.ok(form.querySelector('[data-action="addResource"]'));
  assert.ok(form.querySelector('[data-action="editResource"]'));
  assert.ok(form.querySelector('[data-action="removeEffect"]'));
  app.element = form;
  app.render = () => {};
  const plus = form.querySelector('[data-action="adjust"][data-direction="1"]');
  form.querySelector('[name="delta"]').value = "17";
  await ResourceManager.adjust.call(app, {}, plus);
  assert.equal(stateOf(actor).value, 17);
});

test("resource manager is GM-only", () => {
  globalThis.game.user.isGM = false;
  assert.throws(() => new ResourceManager(), /GM|Permission/i);
});
