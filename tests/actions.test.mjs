import test from "node:test";
import assert from "node:assert/strict";
import { parseEffectCommand } from "../scripts/commands.mjs";
import { ThresholdActions, markResourceDamage } from "../scripts/actions.mjs";
import { defaultDefinitions, MODULE_ID, validateDefinitions } from "../scripts/domain.mjs";
import { actorFixture } from "./helpers.mjs";
import { ResourceService } from "../scripts/service.mjs";
import { statusFixture, stateOf } from "./helpers.mjs";

test("threshold effects parse native damage and ordinary roll commands independently from description", () => {
  for (const effect of ["[[/damage 6d10 type=necrotic]]", "/damage 6d10 necrotic", "6d10[necrotic]", "/r 6д10[necrotic]"]) {
    assert.deepEqual(parseEffectCommand(effect), { formula: "6d10", damageType: "necrotic" });
  }
  assert.deepEqual(parseEffectCommand("/roll 1d20 + 3"), { formula: "1d20 + 3", damageType: "" });
  assert.equal(parseEffectCommand(""), null);
  const defs = defaultDefinitions();
  defs[0].thresholds[1].effect = "[[/damage 6d10 type=necrotic]]";
  const threshold = validateDefinitions(defs)[0].thresholds[1];
  assert.equal(threshold.effect, "[[/damage 6d10 type=necrotic]]");
  assert.notEqual(threshold.description, threshold.effect);
});

test("unsupported commands, multiple actions and unreasonable dice are rejected", () => {
  for (const effect of ["/macro evil", "/damage 6d10 type=invalid", "/damage 6d10", "/r 1d6\n/r 1d6", "[[/r 1d6]]<script>x</script>", "/r 999999d100", "/r 1d0"]) {
    assert.throws(() => parseEffectCommand(effect), undefined, effect);
  }
});

function setup() {
  const actor = actorFixture();
  actor.getRollData = () => ({ prof: 3 });
  const messages = new Map();
  const damageCalls = [];
  let rolled = 0;
  class NativeRoll {
    constructor(formula, data, options) { Object.assign(this, { formula, data, options }); }
    async evaluate() { rolled++; this.total = 36; return this; }
    toJSON() { return { class: "DamageRoll", formula: this.formula, options: this.options, total: this.total, evaluated: true }; }
  }
  const chat = {
    getSpeaker: ({ actor }) => ({ actor: actor.id }),
    async create(data, options) {
      assert.equal(options.keepId, true);
      const message = { ...data, id: data._id, async update(updates) { Object.assign(this, updates); return this; } };
      messages.set(data._id, message);
      return message;
    }
  };
  actor.applyDamage = async (damages, options) => {
    damageCalls.push(damages);
    const updates = {};
    if (markResourceDamage(actor, damages[0].value, updates, options) !== false) await actor.update(updates);
    return actor;
  };
  let next = 0;
  const actions = new ThresholdActions({ damageRoll: () => NativeRoll, roll: () => NativeRoll, chat: () => chat, messages: () => messages, id: () => `action${++next}` });
  const definition = defaultDefinitions()[0];
  const threshold = { ...definition.thresholds[1], effect: "[[/damage 6d10 type=necrotic]]", autoDamage: true };
  return { actor, actions, definition, threshold, messages, damageCalls, rolled: () => rolled };
}

test("native typed threshold damage posts its evaluated roll and applies to the affected Actor once", async () => {
  const { actor, actions, definition, threshold, messages, damageCalls, rolled } = setup();
  const record = await actions.prepare(actor, definition, threshold);
  await actor.update({ [`flags.${MODULE_ID}.pendingActions`]: [record] });
  await actions.execute(actor, record);
  await actions.execute(actor, record);
  assert.equal(rolled(), 1);
  assert.equal(messages.size, 1);
  assert.equal(damageCalls.length, 1);
  assert.equal(damageCalls[0][0].value, 36);
  assert.equal(damageCalls[0][0].type, "necrotic");
  const message = [...messages.values()][0];
  assert.equal(message.flags.dnd5e.roll.type, "damage");
  assert.equal(message.rolls[0].total, 36);
  assert.equal(message.flags[MODULE_ID].actorUuid, actor.uuid);
});

test("chat-only damage never changes HP, while the stored roll survives a retry", async () => {
  const { actor, actions, definition, threshold, messages, damageCalls, rolled } = setup();
  threshold.autoDamage = false;
  const record = await actions.prepare(actor, definition, threshold);
  await actions.execute(actor, record);
  await actions.execute(actor, record);
  assert.equal(damageCalls.length, 0);
  assert.equal(rolled(), 1);
  assert.equal(messages.size, 1);
});

test("damage marker is scoped to pending resource actions and preserves unrelated native damage", async () => {
  const actor = actorFixture();
  const updates = { "system.attributes.hp.value": 70 };
  assert.equal(markResourceDamage(actor, 10, updates, {}), undefined);
  assert.deepEqual(updates, { "system.attributes.hp.value": 70 });
  assert.equal(markResourceDamage(actor, 10, updates, { [MODULE_ID]: { actionId: "unknown" } }), false);
});

test("resource action execution refuses foreign Actors", async () => {
  const { actor, actions, definition, threshold } = setup();
  const record = await actions.prepare(actor, definition, threshold);
  actor.isOwner = false;
  await assert.rejects(actions.execute(actor, record), /permission/i);
});

test("retry after a failed cleanup keeps the original chat roll and cannot apply HP damage twice", async () => {
  const { actor, actions, definition, threshold, damageCalls, messages, rolled } = setup();
  definition.thresholds[1] = threshold;
  const service = new ResourceService({ definitions: () => [definition], statusEffect: statusFixture, actions });
  const update = actor.update.bind(actor);
  let failCleanup = true;
  actor.update = async changes => {
    if (failCleanup && changes[`flags.${MODULE_ID}.pendingActions`]?.length === 0) throw new Error("Cleanup failed");
    return update(changes);
  };
  await assert.rejects(service.set(actor, "nerve-damage", 100), /Cleanup failed/);
  assert.equal(stateOf(actor).value, 0);
  assert.equal(actor.getFlag(MODULE_ID, "pendingActions").length, 1);
  failCleanup = false;
  await service.retryActions(actor);
  assert.equal(rolled(), 1);
  assert.equal(messages.size, 1);
  assert.equal(damageCalls.length, 1);
  assert.deepEqual(actor.getFlag(MODULE_ID, "pendingActions"), []);
});

test("applied-action markers cannot expire while their cleanup remains pending", async () => {
  const actor = actorFixture();
  actor.flags[MODULE_ID] = {
    pendingActions: [{ id: "old", actorUuid: actor.uuid, autoDamage: true, damageType: "necrotic" }, { id: "new", actorUuid: actor.uuid, autoDamage: true, damageType: "necrotic" }],
    appliedActions: ["old", ...Array.from({ length: 200 }, (_, i) => `completed-${i}`)]
  };
  const updates = {};
  markResourceDamage(actor, 36, updates, { [MODULE_ID]: { actionId: "new" } });
  assert.ok(updates[`flags.${MODULE_ID}.appliedActions`].includes("old"));
});
