import test from "node:test";
import assert from "node:assert/strict";
import { defaultDefinitions, transition, validateDefinitions } from "../scripts/domain.mjs";

const nerve = () => defaultDefinitions()[0];

test("crossing 20 records threshold history without mutating input", () => {
  const state = { value: 15, reached: [], cycles: 0 };
  const result = transition(nerve(), state, 20);
  assert.equal(result.state.value, 20);
  assert.deepEqual(result.state.reached, ["warning"]);
  assert.deepEqual(result.activate.map(t => t.id), ["warning"]);
  assert.equal(state.value, 15);
});

test("jumping beyond 100 fires all thresholds then resets exactly to zero", () => {
  const result = transition(nerve(), {}, 205);
  assert.equal(result.state.value, 0);
  assert.equal(result.state.cycles, 1);
  assert.deepEqual(result.state.reached, ["warning", "paralysis"]);
  assert.deepEqual(result.activate.map(t => t.id), ["warning", "paralysis"]);
  assert.equal(result.activate[1].status, "paralyzed");
});

test("sticky thresholds survive falling values and do not fire twice", () => {
  const result = transition(nerve(), { value: 30, reached: ["warning"] }, 10);
  assert.deepEqual(result.state.reached, ["warning"]);
  assert.deepEqual(result.deactivate, []);
  assert.deepEqual(transition(nerve(), result.state, 25).activate, []);
});

test("current-value thresholds deactivate below threshold and can reactivate", () => {
  const def = nerve();
  def.thresholds[0].mode = "current";
  const low = transition(def, { value: 25, reached: ["warning"] }, 10);
  assert.deepEqual(low.deactivate.map(t => t.id), ["warning"]);
  assert.deepEqual(low.state.reached, ["warning"]);
  assert.deepEqual(transition(def, low.state, 20).activate.map(t => t.id), ["warning"]);
});

test("current thresholds are removed on rollover but terminal status survives", () => {
  const def = nerve();
  def.thresholds.forEach(t => { t.mode = "current"; });
  const result = transition(def, { value: 30, reached: ["warning"] }, 100);
  assert.deepEqual(result.deactivate.map(t => t.id), ["warning"]);
  assert.deepEqual(result.activate.map(t => t.id), ["paralysis"]);
});

test("negative values clamp at zero and nonresetting resources cap at max", () => {
  assert.equal(transition(nerve(), {}, -5).state.value, 0);
  const def = nerve();
  def.resetOnMax = false;
  assert.equal(transition(def, {}, 150).state.value, 100);
});

test("invalid numeric edits are rejected, not silently converted to zero", () => {
  for (const value of [NaN, Infinity, "", "no", null]) {
    assert.throws(() => transition(nerve(), {}, value), /number/i);
  }
});

test("definition validation rejects collisions, unsafe IDs and malformed effects", () => {
  for (const mutate of [
    d => d.push(structuredClone(d[0])),
    d => { d[0].id = "__proto__"; },
    d => { d[0].max = 0; },
    d => { d[0].color = "red;position:fixed"; },
    d => { d[0].thresholds[0].at = 101; },
    d => { d[0].thresholds[0].changes = [{ key: "flags.evil", mode: 2, value: "1" }]; },
    d => { d[0].thresholds[0].changes = [{ key: "system.attributes.ac.bonus", mode: 99, value: "1" }]; }
  ]) {
    const defs = defaultDefinitions();
    mutate(defs);
    assert.throws(() => validateDefinitions(defs));
  }
});

test("valid custom changes and unordered thresholds normalize safely", () => {
  const defs = defaultDefinitions();
  defs[0].thresholds.reverse();
  defs[0].thresholds[0].changes = [{ key: "system.attributes.ac.bonus", mode: 2, value: "-2" }];
  const result = validateDefinitions(defs);
  assert.deepEqual(result[0].thresholds.map(t => t.at), [20, 100]);
  assert.equal(result[0].thresholds[1].changes[0].value, "-2");
});

test("v14 native effect modifiers validate and legacy modes normalize to native types", () => {
  const defs = defaultDefinitions();
  defs[0].thresholds[0].changes = [
    { key: "system.attributes.ac.bonus", type: "add", phase: "initial", value: "-2" },
    { key: "system.test", mode: 5, value: "1" }
  ];
  const changes = validateDefinitions(defs)[0].thresholds[0].changes;
  assert.equal(changes[0].type, "add");
  assert.equal(changes[1].type, "override");
  assert.equal(changes[1].phase, "initial");
});
