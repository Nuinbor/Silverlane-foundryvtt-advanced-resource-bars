import test from "node:test";
import assert from "node:assert/strict";
import { CombatIntegration, validateItemRules } from "../scripts/combat.mjs";
import { ResourceService } from "../scripts/service.mjs";
import { defaultDefinitions, MODULE_ID } from "../scripts/domain.mjs";
import { actorFixture, stateOf, statusFixture } from "./helpers.mjs";

function setup() {
  const hero = actorFixture({ uuid: "Scene.s.Token.t.Actor.hero" });
  const other = actorFixture({ uuid: "Actor.other" });
  const documents = new Map([
    ["Scene.s.Token.t", { documentName: "Token", actor: hero }],
    ["Scene.s.Token.miss", { documentName: "Token", actor: other }]
  ]);
  const resolve = async uuid => documents.get(uuid);
  const game = { user: { id: "gm", isGM: true }, users: { activeGM: { id: "gm" }, get: id => ({ id, isGM: id === "gm" }) }, modules: new Map() };
  const service = new ResourceService({ definitions: defaultDefinitions, resolve, statusEffect: statusFixture });
  const integration = new CombatIntegration({ service, game, resolve });
  const rules = [{ resourceId: "nerve-damage", amount: 5, trigger: "hit", activityId: "bite" }];
  const item = { documentName: "Item", uuid: "Actor.monster.Item.bite", isOwner: true, getFlag: (scope, key) => scope === MODULE_ID && key === "attackRules" ? rules : undefined };
  const message = {
    uuid: "ChatMessage.attack1", type: "attack", rolls: [{}], author: { id: "gm", isGM: true },
    getAssociatedItem: () => item, getAssociatedActivity: () => ({ id: "bite" }),
    system: { evaluatedTargets: [{ token: "Scene.s.Token.t", isMiss: false }, { token: "Scene.s.Token.miss", isMiss: true }] }
  };
  return { hero, other, game, integration, rules, item, message, documents };
}

test("native D&D5e 6.1 evaluated hits update the exact token Actor, not misses", async () => {
  const { integration, message, hero, other } = setup();
  await integration.onAttackMessage(message);
  assert.equal(stateOf(hero).value, 5);
  assert.equal(stateOf(other), undefined);
});

test("attack message updates and a replay do not reapply the same hit", async () => {
  const { integration, message, hero } = setup();
  await integration.onAttackMessage(message);
  await integration.onAttackMessage(message);
  assert.equal(stateOf(hero).value, 5);
});

test("only elected active GM processes a broadcast attack hook", async () => {
  const { integration, message, hero, game } = setup();
  game.users.activeGM.id = "another-gm";
  await integration.onAttackMessage(message);
  assert.equal(stateOf(hero), undefined);
});

test("native hit hooks are ignored while Midi-QOL supplies hit results", async () => {
  const { integration, message, hero, game, item } = setup();
  game.modules.set("midi-qol", { active: true });
  await integration.onAttackMessage(message);
  assert.equal(stateOf(hero), undefined);
  await integration.onMidiComplete({ uuid: "workflow1", item, activity: { id: "bite" }, hitTargets: new Set([{ document: { actor: hero } }]) });
  assert.equal(stateOf(hero).value, 5);
});

test("activity-specific rules ignore another activity on the same item", async () => {
  const { integration, message, hero } = setup();
  message.getAssociatedActivity = () => ({ id: "claw" });
  await integration.onAttackMessage(message);
  assert.equal(stateOf(hero), undefined);
});

test("positive applied damage uses its associated Item; zero and healing are ignored", async () => {
  const { integration, message, hero, rules } = setup();
  rules[0].trigger = "damage";
  await integration.onDamage(hero, -10, { origin: message });
  await integration.onDamage(hero, 0, { origin: message });
  assert.equal(stateOf(hero), undefined);
  await integration.onDamage(hero, 8, { origin: message });
  assert.equal(stateOf(hero).value, 5);
});

test("damage without an attributable origin does not guess using current targets", async () => {
  const { integration, hero } = setup();
  await integration.onDamage(hero, 8, {});
  assert.equal(stateOf(hero), undefined);
});

test("native right-click Apply Damage uses D&D5e originatingMessage option", async () => {
  const { integration, message, hero, rules } = setup();
  rules[0].trigger = "damage";
  await integration.onDamage(hero, 8, { originatingMessage: message });
  assert.equal(stateOf(hero)?.value, 5);
});

test("manual hit application requires item ownership and validates all targets first", async () => {
  const { integration, item, hero } = setup();
  const foreign = actorFixture({ owner: false });
  await assert.rejects(integration.applyItem(item, [hero, foreign], { trigger: "hit", activityId: "bite" }), /permission/i);
  assert.equal(stateOf(hero), undefined);
});

test("without a GM only the message author processes owned targets", async () => {
  const { integration, message, hero, game } = setup();
  game.users.activeGM = null;
  game.user = { id: "player", isGM: false };
  message.author = { id: "player", isGM: false };
  await integration.onAttackMessage(message);
  assert.equal(stateOf(hero).value, 5);
});

test("a player-crafted attack broadcast cannot make the GM write to an unowned target", async () => {
  const { integration, message, hero } = setup();
  message.author = { id: "player", isGM: false };
  hero.ownership.player = 0;
  await integration.onAttackMessage(message);
  assert.equal(stateOf(hero), undefined);
});

test("player-authored Midi workflows cannot use the elected GM as a foreign-Actor write proxy", async () => {
  const { integration, game, item, hero } = setup();
  game.modules.set("midi-qol", { active: true });
  hero.ownership.player = 0;
  await integration.onMidiComplete({ uuid: "player-workflow", userId: "player", item, activity: { id: "bite" }, hitTargets: new Set([{ actor: hero }]) });
  assert.equal(stateOf(hero), undefined);
});

test("malformed item rules are rejected before the combat adapter mutates data", () => {
  for (const rules of [null, [{ resourceId: "bad.path", amount: 5 }], [{ resourceId: "nerve-damage", amount: NaN }], [{ resourceId: "nerve-damage", amount: 5, trigger: "miss" }]]) {
    assert.throws(() => validateItemRules(rules));
  }
});
