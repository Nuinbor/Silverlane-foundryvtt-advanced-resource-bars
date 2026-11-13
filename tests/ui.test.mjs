import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Handlebars from "handlebars";
import { Window } from "happy-dom";
import { defaultDefinitions } from "../scripts/domain.mjs";
import { ResourceService } from "../scripts/service.mjs";
import { actorFixture, statusFixture } from "./helpers.mjs";

globalThis.foundry = { applications: { api: {
  ApplicationV2: class { constructor(options = {}) { this.options = options; } },
  HandlebarsApplicationMixin: Base => Base
} } };
const { trackerContext, readDefinitionForm, readItemRulesForm, ResourceTracker, ResourceConfig } = await import("../scripts/ui.mjs");

test("tracker renders escaped user text, threshold history, and editable numeric values", async () => {
  const definitions = defaultDefinitions();
  definitions[0].name = '<img src=x onerror="alert(1)">';
  const actor = actorFixture();
  const service = new ResourceService({ definitions: () => definitions, statusEffect: statusFixture });
  await service.set(actor, "nerve-damage", 25);
  const context = trackerContext([actor], service, key => key);
  Handlebars.registerHelper("localize", key => key);
  const template = Handlebars.compile(await readFile(new URL("../templates/tracker.hbs", import.meta.url), "utf8"));
  const document = new Window().document;
  document.body.innerHTML = template(context);
  assert.equal(document.querySelector("img"), null);
  assert.match(document.body.textContent, /<img src=x/);
  assert.equal(document.querySelector('input[data-edit-value][data-resource-id="nerve-damage"]').value, "25");
  const ticks = document.querySelectorAll(".srb-tick");
  assert.equal(ticks.length, 2);
  assert.equal(ticks[0].classList.contains("reached"), true);
  assert.match(ticks[0].getAttribute("title"), /20/);
});

test("empty tracker renders actionable instructions instead of throwing", async () => {
  const context = trackerContext([], { get: () => [] }, key => key);
  assert.equal(context.hasActors, false);
  const app = new ResourceTracker({ actors: [], service: { get: () => [] } });
  assert.deepEqual(app.actors, []);
});

test("resource editor reads checkbox, threshold mode, changes and status from actual form controls", () => {
  const document = new Window().document;
  const form = document.createElement("form");
  form.innerHTML = `<input name="name" value="Нервы"><input name="max" value="100"><input name="color" value="#a879e8">
    <textarea name="description">Описание</textarea><input name="resetOnMax" type="checkbox" checked>
    <input name="showOnToken" type="checkbox"><section data-threshold-id="warning">
    <input name="thresholdName" value="Тремор"><input name="at" value="20"><select name="mode"><option value="current" selected>current</option></select>
    <select name="status"><option value="">none</option></select><input name="duration" value="60">
    <textarea name="thresholdDescription">Штраф КД</textarea><textarea name="changes">[{"key":"system.attributes.ac.bonus","mode":2,"value":"-2"}]</textarea></section>`;
  const result = readDefinitionForm(form, "nerve-damage");
  assert.equal(result.showOnToken, false);
  assert.equal(result.resetOnMax, true);
  assert.equal(result.thresholds[0].mode, "current");
  assert.equal(result.thresholds[0].changes[0].value, "-2");
  form.querySelector('[name="changes"]').value = "not JSON";
  assert.throws(() => readDefinitionForm(form, "nerve-damage"));
});

test("item editor reads selected activity and trigger with a numeric delta", () => {
  const form = new Window().document.createElement("form");
  form.innerHTML = `<section data-rule-index="0"><select name="resourceId"><option value="nerve-damage">Nerves</option></select>
    <input name="amount" value="5"><select name="trigger"><option value="hit">Hit</option></select>
    <select name="activityId"><option value="bite">Bite</option></select></section>`;
  assert.deepEqual(readItemRulesForm(form), [{ resourceId: "nerve-damage", amount: 5, trigger: "hit", activityId: "bite" }]);
});

test("D&D5e 6.1 status dictionaries populate and save the GM resource editor", async () => {
  const definitions = defaultDefinitions();
  let saved;
  let closed = false;
  globalThis.game = {
    user: { isGM: true }, i18n: { localize: key => key },
    settings: { get: () => definitions, async set(scope, key, value) { saved = value; } }
  };
  globalThis.CONFIG = { statusEffects: {
    paralyzed: { id: "paralyzed", name: "Paralyzed" }, poisoned: { id: "poisoned", name: "Poisoned" }
  } };
  globalThis.ui = { notifications: { info() {} } };
  const app = new ResourceConfig();
  const context = await app._prepareContext();
  assert.equal(context.selected.thresholds[1].statuses.find(s => s.id === "paralyzed").selected, true);
  const form = new Window().document.createElement("form");
  form.innerHTML = Handlebars.compile(await readFile(new URL("../templates/resource-config.hbs", import.meta.url), "utf8"))(context);
  app.element = form;
  app.close = async () => { closed = true; };
  await ResourceConfig.submit.call(app);
  assert.equal(saved?.[0].thresholds[1].status, "paralyzed");
  assert.equal(closed, true);
});

test("D&D5e 5.3.3 / Foundry 13 status arrays populate the same resource editor", async () => {
  globalThis.game = {
    user: { isGM: true }, i18n: { localize: key => key },
    settings: { get: () => defaultDefinitions() }
  };
  globalThis.CONFIG = { statusEffects: [
    { id: "paralyzed", name: "Paralyzed" }, { id: "poisoned", name: "Poisoned" }
  ] };
  const app = new ResourceConfig();
  const context = await app._prepareContext();
  assert.equal(context.selected.thresholds[1].statuses.find(s => s.id === "paralyzed").selected, true);
  const form = new Window().document.createElement("form");
  form.innerHTML = Handlebars.compile(await readFile(new URL("../templates/resource-config.hbs", import.meta.url), "utf8"))(context);
  assert.equal(readDefinitionForm(form, "nerve-damage").thresholds[1].status, "paralyzed");
});

test("threshold editor keeps Description separate from the native Effect command and chat-only setting", async () => {
  const definitions = defaultDefinitions();
  definitions[0].thresholds[1].effect = "[[/damage 6d10 type=necrotic]]";
  definitions[0].thresholds[1].autoDamage = false;
  globalThis.game.settings.get = () => definitions;
  const app = new ResourceConfig();
  const context = await app._prepareContext();
  const form = new Window().document.createElement("form");
  form.innerHTML = Handlebars.compile(await readFile(new URL("../templates/resource-config.hbs", import.meta.url), "utf8"))(context);
  const row = form.querySelector('[data-threshold-id="paralysis"]');
  assert.equal(row.querySelector('[name="thresholdEffect"]').value, "[[/damage 6d10 type=necrotic]]");
  row.querySelector('[name="thresholdDescription"]').value = "Отмирание тканей";
  const threshold = readDefinitionForm(form, "nerve-damage").thresholds[1];
  assert.equal(threshold.description, "Отмирание тканей");
  assert.equal(threshold.effect, "[[/damage 6d10 type=necrotic]]");
  assert.equal(threshold.autoDamage, false);
});

test("tracker distinguishes reached history from currently active managed effects", async () => {
  const actor = actorFixture();
  const definitions = defaultDefinitions();
  definitions[0].thresholds[1].effect = "[[/damage 6d10 type=necrotic]]";
  const service = new ResourceService({ definitions: defaultDefinitions, statusEffect: statusFixture });
  await service.set(actor, "nerve-damage", 100);
  actor.effects.push({ id: "foreign", name: "Other paralysis" });
  const context = trackerContext([actor], service, key => key);
  assert.equal(context.actors[0].resources[0].effects.length, 1);
  assert.equal(context.actors[0].resources[0].thresholds[1].active, true);
  await service.removeEffect(actor, actor.effects[0].id);
  const after = trackerContext([actor], service, key => key);
  assert.equal(after.actors[0].resources[0].thresholds[1].reached, true);
  assert.equal(after.actors[0].resources[0].thresholds[1].active, false);
});
