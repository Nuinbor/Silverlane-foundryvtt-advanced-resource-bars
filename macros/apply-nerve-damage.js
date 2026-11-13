// GM macro: apply +5 to each targeted Actor, once per Actor even if several linked tokens are targeted.
const srb = game.modules.get("silverlane-resource-bars").api;
const affected = new Set();
for (const target of game.user.targets) {
  if (!target.actor || affected.has(target.actor.uuid)) continue;
  affected.add(target.actor.uuid);
  await srb.adjust(target.actor, "nerve-damage", 5);
}
