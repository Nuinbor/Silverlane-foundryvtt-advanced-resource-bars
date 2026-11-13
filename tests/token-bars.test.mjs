import test from "node:test";
import assert from "node:assert/strict";
import { tokenBarModel } from "../scripts/token-bars.mjs";
import { defaultDefinitions } from "../scripts/domain.mjs";
import { actorFixture } from "./helpers.mjs";

test("canvas overlay never reveals foreign Actor or hidden-token resources", () => {
  const token = { actor: actorFixture({ owner: false }), document: {}, controlled: true, visible: true };
  assert.deepEqual(tokenBarModel(token, defaultDefinitions(), "always", { isGM: false }), []);
  token.actor.isOwner = true;
  token.document.hidden = true;
  assert.deepEqual(tokenBarModel(token, defaultDefinitions(), "always", { isGM: false }), []);
});

test("overlay respects controlled/hover visibility and disabled resources", () => {
  const token = { actor: actorFixture(), document: {}, controlled: false, hover: false, visible: true };
  assert.equal(tokenBarModel(token, defaultDefinitions(), "controlled", { isGM: true }).length, 0);
  token.hover = true;
  assert.equal(tokenBarModel(token, defaultDefinitions(), "hover", { isGM: true }).length, 1);
  assert.equal(tokenBarModel(token, defaultDefinitions(), "none", { isGM: true }).length, 0);
});
