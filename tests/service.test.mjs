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
  assert.equal(actor.effects[0].system.special, true);
  assert.equal(actor.effects[0].system.type, "paralyzed");
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
  assert.equal(actor.effects[0].system.changes[0].value, "-2");
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

test("a failed effect preparation never mutates Foundry's live flag object", async () => {
  const { actor, definitions } = setup();
  actor.flags[MODULE_ID] = { resources: { "nerve-damage": { value: 95, reached: ["warning"], cycles: 0, enabled: true } } };
  definitions[0].thresholds[1].status = "unknown";
  const service = new ResourceService({ definitions: () => definitions, statusEffect: statusFixture });
  await assert.rejects(service.adjust(actor, "nerve-damage", 5), /Unknown status/);
  assert.equal(stateOf(actor).value, 95);
  assert.deepEqual(stateOf(actor).reached, ["warning"]);
  assert.equal(stateOf(actor).cycles, 0);
});

test("a rejected document update leaves the previous live flag state intact", async () => {
  const { actor, service } = setup();
  await service.set(actor, "nerve-damage", 10);
  actor.update = async () => { throw new Error("Network write rejected"); };
  await assert.rejects(service.adjust(actor, "nerve-damage", 5), /Network write rejected/);
  assert.equal(stateOf(actor).value, 10);
});

test("buildEffect strips inherited IDs, retains system statuses and adds custom changes", async () => {
  const threshold = { ...defaultDefinitions()[0].thresholds[1], duration: 60, changes: [{ key: "system.attributes.ac.bonus", mode: 2, value: "-2" }] };
  const effect = await buildEffect(defaultDefinitions()[0], threshold, async () => ({
    _id: "original", ...await statusFixture("paralyzed"), system: { type: "paralyzed", changes: [{ key: "system.test", type: "override", phase: "initial", value: "1" }] }
  }), 1234);
  assert.equal(effect._id, undefined);
  assert.equal(effect.system.changes.length, 2);
  assert.deepEqual(effect.duration, { value: 60, units: "seconds", expiry: null, expired: false });
  assert.equal(effect.start.time, 1234);
  assert.equal(effect.flags[MODULE_ID].thresholdId, "paralysis");
});

test("v14 effect payload preserves native system changes and appends configured modifiers", async () => {
  const definition = defaultDefinitions()[0];
  const threshold = { ...definition.thresholds[1], duration: 60, changes: [{ key: "system.attributes.ac.bonus", mode: 2, value: "-2" }] };
  const effect = await buildEffect(definition, threshold, async () => ({
    type: "condition", system: { type: "paralyzed", changes: [{ key: "system.test", type: "override", phase: "initial", value: "1" }] },
    statuses: ["paralyzed", "incapacitated"], duration: { value: null, units: "seconds", expiry: null, expired: false }, start: null
  }), 1234);
  assert.equal(effect.changes, undefined);
  assert.equal(effect.system.changes.length, 2);
  assert.equal(effect.system.changes[1].type, "add");
  assert.equal(effect.system.changes[1].phase, "initial");
  assert.deepEqual(effect.statuses, ["paralyzed", "incapacitated"]);
  assert.deepEqual(effect.duration, { value: 60, units: "seconds", expiry: null, expired: false });
  assert.equal(effect.start.time, 1234);
});

test("custom-only v14 effects use the D&D5e base type and native system.changes", async () => {
  const definition = defaultDefinitions()[0];
  const threshold = { ...definition.thresholds[0], changes: [{ key: "system.attributes.ac.bonus", type: "add", phase: "initial", value: "-2" }] };
  const effect = await buildEffect(definition, threshold, statusFixture);
  assert.equal(effect.type, "base");
  assert.equal(effect.system.changes[0].type, "add");
  assert.equal(effect.system.changes[0].value, "-2");
});

test("failed resource persistence compensates newly created terminal effects", async () => {
  const { actor, service } = setup();
  await service.set(actor, "nerve-damage", 95);
  actor.update = async () => { throw new Error("Write rejected"); };
  await assert.rejects(service.adjust(actor, "nerve-damage", 5), /Write rejected/);
  assert.equal(stateOf(actor).value, 95);
  assert.equal(actor.effects.length, 0);
});

test("failed treatment restores removed managed effects with original IDs", async () => {
  const { actor, service } = setup();
  await service.set(actor, "nerve-damage", 100);
  const previous = structuredClone(actor.effects);
  actor.update = async () => { throw new Error("Write rejected"); };
  await assert.rejects(service.reset(actor, "nerve-damage", { clearHistory: true }), /Write rejected/);
  assert.deepEqual(actor.effects, previous);
  assert.deepEqual(stateOf(actor).reached, ["warning", "paralysis"]);
});

test("refused effect creation does not consume threshold history", async () => {
  const { actor, service } = setup();
  actor.createEmbeddedDocuments = async () => [];
  await assert.rejects(service.set(actor, "nerve-damage", 100), /effect.*refused/i);
  assert.equal(stateOf(actor), undefined);
});

test("refused Actor updates compensate effects just like thrown errors", async () => {
  const { actor, service } = setup();
  actor.update = async () => undefined;
  await assert.rejects(service.set(actor, "nerve-damage", 100), /update.*refused/i);
  assert.equal(actor.effects.length, 0);
});
