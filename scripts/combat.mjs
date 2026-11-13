import { MODULE_ID, numeric } from "./domain.mjs";

export function validateItemRules(input) {
  if (!Array.isArray(input) || input.length > 100) throw new Error("Expected up to 100 attack rules.");
  return input.map(rule => {
    if (typeof rule.resourceId !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(rule.resourceId)
      || ["constructor", "prototype", "__proto__"].includes(rule.resourceId)) throw new Error("Invalid rule resource ID.");
    const amount = numeric(rule.amount);
    if (Math.abs(amount) > 1_000_000) throw new Error("Rule delta is too large.");
    const trigger = rule.trigger ?? "hit";
    if (!["hit", "damage", "manual"].includes(trigger)) throw new Error("Unknown rule trigger.");
    const activityId = rule.activityId ?? "";
    if (typeof activityId !== "string" || (activityId && !/^[a-zA-Z0-9_-]{1,80}$/.test(activityId))) throw new Error("Invalid activity ID.");
    return { resourceId: rule.resourceId, amount, trigger, activityId };
  });
}

export class CombatIntegration {
  constructor({ service, game, resolve = uuid => globalThis.fromUuid(uuid) }) {
    Object.assign(this, { service, game, resolve });
  }

  #rules(item, trigger, activityId) {
    return validateItemRules(item?.getFlag(MODULE_ID, "attackRules") ?? [])
      .filter(rule => rule.trigger === trigger && (!rule.activityId || rule.activityId === activityId));
  }

  #authority(authorId) {
    const gm = this.game.users.activeGM;
    return gm ? gm.id === this.game.user.id : authorId === this.game.user.id;
  }

  #mayApply(actor, author) {
    if (!actor?.isOwner || !author) return false;
    // A broadcast must not turn the elected GM into a permission proxy for its author.
    return author.isGM || Boolean(actor.testUserPermission?.(author, "OWNER"));
  }

  get midiActive() { return Boolean(this.game.modules.get("midi-qol")?.active); }

  async onAttackMessage(message) {
    if (this.midiActive || message.type !== "attack" || !message.rolls?.length || !this.#authority(message.author?.id)) return;
    const item = message.getAssociatedItem?.();
    const activityId = message.getAssociatedActivity?.()?.id ?? message.system?.activity?.id;
    const rules = this.#rules(item, "hit", activityId);
    if (!rules.length) return;
    const actors = new Map();
    for (const target of message.system?.evaluatedTargets ?? []) {
      if (target.isMiss !== false) continue;
      const document = await this.resolve(target.token ?? target.actor);
      const actor = document?.documentName === "Actor" ? document : document?.actor;
      if (this.#mayApply(actor, message.author)) actors.set(actor.uuid, actor);
    }
    for (const actor of actors.values()) await this.service.applyRules(actor, rules, { eventId: `hit:${message.uuid}` });
  }

  async onDamage(actor, amount, options = {}) {
    if (!(amount > 0) || !actor.isOwner) return;
    // The damage tray uses origin; the chat-card context menu uses originatingMessage.
    const source = options.origin ?? options.originatingMessage;
    const origin = typeof source === "string" ? await this.resolve(source) : source;
    if (!origin) return;
    const item = origin.getAssociatedItem?.();
    const activityId = origin.getAssociatedActivity?.()?.id ?? origin.system?.activity?.id;
    const rules = this.#rules(item, "damage", activityId);
    if (!rules.length) return;
    // applyDamage is a local hook, not broadcast: the user applying damage owns this Actor.
    await this.service.applyRules(actor, rules, { eventId: origin.uuid ? `damage:${origin.uuid}` : undefined });
  }

  async onMidiComplete(workflow) {
    if (!this.midiActive || !this.#authority(workflow.userId ?? workflow.user?.id)) return;
    const authorId = workflow.userId ?? workflow.user?.id ?? this.game.user.id;
    const author = this.game.users.get?.(authorId) ?? (authorId === this.game.user.id ? this.game.user : null);
    const rules = this.#rules(workflow.item, "hit", workflow.activity?.id);
    if (!rules.length) return;
    const actors = new Map();
    for (const token of workflow.hitTargets ?? []) {
      const actor = token.actor ?? token.document?.actor;
      if (this.#mayApply(actor, author)) actors.set(actor.uuid, actor);
    }
    for (const actor of actors.values()) await this.service.applyRules(actor, rules, { eventId: workflow.uuid ? `midi:${workflow.uuid}` : undefined });
  }

  /** Explicit confirmation, not a guessed attack result. Requires permission on every target. */
  async applyItem(item, targets, { trigger = "manual", activityId = "", eventId } = {}) {
    if (typeof item === "string") item = await this.resolve(item);
    if (!item?.isOwner) throw new Error("Permission denied: you must own the source Item.");
    if (!["hit", "damage", "manual"].includes(trigger)) throw new Error("Unknown rule trigger.");
    const rules = this.#rules(item, trigger, activityId);
    const actors = new Map();
    for (let target of targets ?? []) {
      if (typeof target === "string") target = await this.resolve(target);
      const actor = target?.documentName === "Actor" ? target : target?.actor ?? target?.document?.actor;
      if (!actor?.isOwner) throw new Error("Permission denied: every target must be owned or applied by a GM.");
      actors.set(actor.uuid, actor);
    }
    if (!actors.size) throw new Error("Select at least one target.");
    if (!rules.length) throw new Error("No matching resource rules for this trigger and activity.");
    const results = [];
    for (const actor of actors.values()) results.push(await this.service.applyRules(actor, rules, { eventId }));
    return results;
  }
}
