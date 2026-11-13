import { MODULE_ID } from "./domain.mjs";
import { parseEffectCommand } from "./commands.mjs";

const escape = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Native preApplyDamage hook: the marker and HP are saved in the SAME Actor update. */
export function markResourceDamage(actor, amount, updates, options = {}) {
  const id = options[MODULE_ID]?.actionId;
  if (!id) return;
  const applied = actor.getFlag(MODULE_ID, "appliedActions") ?? [];
  const pending = actor.getFlag(MODULE_ID, "pendingActions") ?? [];
  if (!actor.isOwner || applied.includes(id) || !pending.some(a => a.id === id && a.actorUuid === actor.uuid && a.autoDamage && a.damageType)) return false;
  const pendingIds = new Set(pending.map(a => a.id));
  updates[`flags.${MODULE_ID}.appliedActions`] = [...new Set([...applied.filter(id => pendingIds.has(id)), ...applied.slice(-199), id])];
}

export class ThresholdActions {
  constructor({ damageRoll = () => CONFIG.Dice.DamageRoll, roll = () => globalThis.Roll,
    chat = () => CONFIG.ChatMessage.documentClass, messages = () => game.messages,
    id = () => foundry.utils.randomID() } = {}) {
    Object.assign(this, { damageRoll, roll, chat, messages, id });
  }

  async prepare(actor, definition, threshold) {
    const command = parseEffectCommand(threshold.effect);
    if (!command) return null;
    if (!actor.isOwner) throw new Error("Permission denied: you must own the Actor.");
    const RollClass = command.damageType ? this.damageRoll() : this.roll();
    const roll = await new RollClass(command.formula, actor.getRollData?.() ?? {}, command.damageType ? { type: command.damageType } : {}).evaluate();
    if (!Number.isFinite(roll.total) || (command.damageType && roll.total < 0)) throw new Error("The threshold roll did not produce valid damage.");
    return {
      id: this.id(), messageId: this.id(), actorUuid: actor.uuid, resourceId: definition.id, thresholdId: threshold.id,
      name: `${definition.name}: ${threshold.name}`, description: threshold.description, ...command,
      autoDamage: Boolean(command.damageType && threshold.autoDamage !== false), roll: roll.toJSON(), total: roll.total
    };
  }

  async execute(actor, record) {
    if (!actor.isOwner || record.actorUuid !== actor.uuid) throw new Error("Permission denied: wrong resource action Actor.");
    let message = this.messages().get(record.messageId);
    if (message && message.flags?.[MODULE_ID]?.actionId !== record.id) throw new Error("Resource action message ID collision.");
    if (!message) {
      const Chat = this.chat();
      const mode = record.autoDamage ? "Auto damage / Автоурон" : "Chat roll / Бросок в чат";
      message = await Chat.create({
        _id: record.messageId, speaker: Chat.getSpeaker({ actor }), rolls: [record.roll],
        flavor: `<strong>${escape(record.name)}</strong><br>${escape(actor.name)} · ${mode}<br>${escape(record.description)}`,
        flags: {
          [MODULE_ID]: { actionId: record.id, actorUuid: actor.uuid, resourceId: record.resourceId, thresholdId: record.thresholdId, autoDamage: record.autoDamage },
          dnd5e: { messageType: "roll", roll: { type: record.damageType ? "damage" : "formula" } }
        }
      }, { keepId: true });
      if (!message) throw new Error("Chat roll creation was refused. Retry the pending action.");
    }
    if (record.autoDamage && !(actor.getFlag(MODULE_ID, "appliedActions") ?? []).includes(record.id)) {
      await actor.applyDamage([{ value: record.total, type: record.damageType, properties: new Set() }], { [MODULE_ID]: { actionId: record.id } });
      if (!(actor.getFlag(MODULE_ID, "appliedActions") ?? []).includes(record.id)) {
        throw new Error("Damage was blocked or not saved. The prepared roll is pending; it can be retried.");
      }
    }
    return message;
  }
}
