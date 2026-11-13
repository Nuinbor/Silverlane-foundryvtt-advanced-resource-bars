import test from "node:test";
import assert from "node:assert/strict";
import { defaultDefinitions, MODULE_ID } from "../scripts/domain.mjs";
import { ResourceService } from "../scripts/service.mjs";
import { buildEffect } from "../scripts/effects.mjs";
import { actorFixture, stateOf, statusFixture } from "./helpers.mjs";

function setup(options = {}) {
  const actor = actorFixture(options);
  const definitions = defaultDefinitions();
  return { actor, definitions, service: new ResourceService({ definitions: () => definitions, resolve: async () => actor, statusEffect: statusFixture }) };
}

test("API denies foreign Actor writes and reads without a GM proxy", async () => {
  const { actor, service } = setup({ owner: false });
  await assert.rejects(service.adjust(actor, "nerve-damage", 5), /permission/i);
  assert.throws(() => service.get(actor), /permission/i);
  assert.equal(actor.updates.length, 0);
});

test("concurrent increments serialize against latest persisted Actor state", async () => {
  const { actor, service } = setup();
  await Promise.all(Array.from({ length: 12 }, () => service.adjust(actor, "nerve-damage", 5)));
  assert.equal(stateOf(actor).value, 60);
  assert.deepEqual(stateOf(actor).reached, ["warning"]);
});

test("synthetic Actor updates are retained on token Actor and not a base Actor lookup", async () => {
  const { service } = setup();
  const synthetic = actorFixture({ uuid: "Scene.scene.Token.token.Actor.base" });
  await service.adjust({ documentName: "Token", actor: synthetic }, "nerve-damage", 7);
  assert.equal(stateOf(synthetic).value, 7);
});

test("terminal transition creates system-aware status and persists after numeric reset", async () => {
  const { actor, service } = setup();
  await service.set(actor, "nerve-damage", 100);
  assert.equal(stateOf(actor).value, 0);
  assert.equal(actor.effects.length, 1);
  assert.equal(actor.effects[0].type, "condition");
  assert.deepEqual(actor.effects[0].system, { special: true });
  assert.deepEqual(actor.effects[0].statuses, ["paralyzed"]);
  await service.reset(actor, "nerve-damage");
  assert.equal(actor.effects.length, 1);
});

test("treatment clears history and only this resource's managed effects", async () => {
  const { actor, service } = setup();
  actor.effects.push({ id: "unrelated", name: "Someone else's paralysis", statuses: ["paralyzed"] });
  await service.set(actor, "nerve-damage", 100);
  await service.reset(actor, "nerve-damage", { clearHistory: true });
  assert.deepEqual(actor.effects.map(e => e.id), ["unrelated"]);
  assert.deepEqual(stateOf(actor).reached, []);
  await service.set(actor, "nerve-damage", 100);
  assert.equal(actor.effects.length, 2);
});

test("current-value custom effects are removed below threshold", async () => {
  const { actor, service, definitions } = setup();
  Object.assign(definitions[0].thresholds[0], { mode: "current", changes: [{ key: "system.attributes.ac.bonus", mode: 2, value: "-2" }] });
  await service.set(actor, "nerve-damage", 25);
  assert.equal(actor.effects[0].changes[0].value, "-2");
  await service.adjust(actor, "nerve-damage", -10);
  assert.equal(actor.effects.length, 0);
});

test("repeated event IDs are deduplicated across new service instances", async () => {
  const { actor, service, definitions } = setup();
  const rules = [{ resourceId: "nerve-damage", amount: 5 }];
  await service.applyRules(actor, rules, { eventId: "attack:42" });
  const next = new ResourceService({ definitions: () => definitions, statusEffect: statusFixture });
  await next.applyRules(actor, rules, { eventId: "attack:42" });
  assert.equal(stateOf(actor).value, 5);
  assert.deepEqual(actor.flags[MODULE_ID].recentEvents, ["attack:42"]);
});

test("invalid rules are fully validated before any resource is mutated", async () => {
  const { actor, service } = setup();
  await assert.rejects(service.applyRules(actor, [
    { resourceId: "nerve-damage", amount: 5 }, { resourceId: "missing", amount: 1 }
  ]), /resource/i);
  assert.equal(actor.updates.length, 0);
});

test("disabled resources ignore combat rules but can be enabled again", async () => {
  const { actor, service } = setup();
  await service.setEnabled(actor, "nerve-damage", false);
  await service.applyRules(actor, [{ resourceId: "nerve-damage", amount: 5 }]);
  assert.equal(stateOf(actor).value, 0);
  await service.setEnabled(actor, "nerve-damage", true);
  await service.adjust(actor, "nerve-damage", 5);
  assert.equal(stateOf(actor).value, 5);
});

test("effect preparation failure does not consume history or event dedup token", async () => {
  const { actor, definitions } = setup();
  definitions[0].thresholds[1].status = "unknown";
  const service = new ResourceService({ definitions: () => definitions, statusEffect: statusFixture });
  await assert.rejects(service.applyRules(actor, [{ resourceId: "nerve-damage", amount: 100 }], { eventId: "bad" }), /Unknown status/);
  assert.equal(actor.updates.length, 0);
});

test("buildEffect strips inherited IDs, retains system statuses and adds custom changes", async () => {
  const threshold = { ...defaultDefinitions()[0].thresholds[1], duration: 60, changes: [{ key: "system.attributes.ac.bonus", mode: 2, value: "-2" }] };
  const effect = await buildEffect(defaultDefinitions()[0], threshold, async () => ({
    _id: "original", ...await statusFixture("paralyzed"), changes: [{ key: "system.test", mode: 5, value: "1" }]
  }), 1234);
  assert.equal(effect._id, undefined);
  assert.equal(effect.changes.length, 2);
  assert.deepEqual(effect.duration, { seconds: 60, startTime: 1234 });
  assert.equal(effect.flags[MODULE_ID].thresholdId, "paralysis");
});
