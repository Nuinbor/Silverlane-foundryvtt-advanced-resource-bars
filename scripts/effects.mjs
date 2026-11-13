import { MODULE_ID, normalizeEffectChanges } from "./domain.mjs";

/** Preserve the game system's status mechanics rather than creating an icon-only condition. */
export async function buildEffect(definition, threshold, statusEffect, worldTime = 0) {
  if (!threshold.status && !threshold.changes.length) return null;
  const base = threshold.status ? structuredClone(await statusEffect(threshold.status)) : {};
  delete base._id;
  delete base.id;
  delete base.origin;
  base.name = `${definition.name}: ${threshold.name}`;
  base.img ||= "icons/svg/downgrade.svg";
  base.disabled = false;
  base.transfer = false;
  base.type ||= "base";
  base.system ??= {};
  base.system.changes = [...(base.system.changes ?? []), ...normalizeEffectChanges(threshold.changes)];
  base.flags = { ...base.flags, [MODULE_ID]: { resourceId: definition.id, thresholdId: threshold.id } };
  if (threshold.duration > 0) {
    base.duration = { value: threshold.duration, units: "seconds", expiry: null, expired: false };
    // Core _preCreate fills the remaining combat-start fields from the live combat.
    base.start = { time: Math.floor(worldTime) };
  }
  return base;
}

export function managedEffects(actor, resourceId, thresholdId) {
  return Array.from(actor.effects ?? []).filter(effect => {
    const tag = effect.flags?.[MODULE_ID];
    return tag?.resourceId === resourceId && (thresholdId == null || tag.thresholdId === thresholdId);
  });
}
