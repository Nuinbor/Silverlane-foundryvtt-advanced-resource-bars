import { MODULE_ID, numeric, transition, validateDefinitions } from "./domain.mjs";
import { buildEffect, managedEffects } from "./effects.mjs";

/** All writes funnel through a per-Actor queue. No socket handler can write arbitrary documents. */
export class ResourceService {
  #queues = new Map();

  constructor({ definitions, resolve = uuid => globalThis.fromUuid(uuid), statusEffect, worldTime = () => globalThis.game?.time?.worldTime ?? 0 }) {
    this.definitions = definitions;
    this.resolve = resolve;
    this.statusEffect = statusEffect;
    this.worldTime = worldTime;
  }

  get(actor) {
    actor = this.#owned(actor);
    const states = actor.getFlag(MODULE_ID, "resources") ?? {};
    return this.#definitions().map(definition => ({ definition, state: this.#state(states[definition.id]) }));
  }

  async set(actor, resourceId, value, options = {}) {
    numeric(value);
    return this.#mutate(actor, async document => this.#apply(document, [{ resourceId, value }], options));
  }

  async adjust(actor, resourceId, amount, options = {}) {
    amount = numeric(amount);
    return this.#mutate(actor, async document => this.#apply(document, [{ resourceId, amount }], options));
  }

  async applyRules(actor, rules, options = {}) {
    if (!Array.isArray(rules) || rules.length > 100) throw new Error("Invalid resource rules.");
    const edits = rules.map(rule => ({ resourceId: rule.resourceId, amount: numeric(rule.amount) }));
    return this.#mutate(actor, document => this.#apply(document, edits, options));
  }

  async reset(actor, resourceId, { clearHistory = false } = {}) {
    return this.#mutate(actor, async document => {
      this.#definition(resourceId);
      if (!clearHistory) return this.#apply(document, [{ resourceId, value: 0 }]);
      const states = document.getFlag(MODULE_ID, "resources") ?? {};
      const effects = managedEffects(document, resourceId);
      if (effects.length) await document.deleteEmbeddedDocuments("ActiveEffect", effects.map(e => e.id));
      states[resourceId] = { ...this.#state(states[resourceId]), value: 0, reached: [], cycles: 0 };
      await document.update({ [`flags.${MODULE_ID}.resources`]: states });
      return states[resourceId];
    });
  }

  async setEnabled(actor, resourceId, enabled) {
    return this.#mutate(actor, async document => {
      this.#definition(resourceId);
      const states = document.getFlag(MODULE_ID, "resources") ?? {};
      states[resourceId] = { ...this.#state(states[resourceId]), enabled: Boolean(enabled) };
      await document.update({ [`flags.${MODULE_ID}.resources`]: states });
      return states[resourceId];
    });
  }

  #definitions() { return validateDefinitions(this.definitions()); }

  #definition(resourceId) {
    const definition = this.#definitions().find(d => d.id === resourceId);
    if (!definition) throw new Error(`Unknown resource: ${resourceId}`);
    return definition;
  }

  #state(state = {}) {
    return { value: 0, reached: [], cycles: 0, enabled: true, ...structuredClone(state) };
  }

  #owned(input) {
    const actor = input?.documentName === "Actor" ? input : input?.actor ?? input?.document?.actor;
    if (!actor || actor.documentName !== "Actor") throw new Error("An Actor or Token is required.");
    if (!actor.isOwner) throw new Error("Permission denied: you must own the Actor or be a GM.");
    return actor;
  }

  async #mutate(input, operation) {
    const actor = this.#owned(typeof input === "string" ? await this.resolve(input) : input);
    const key = actor.uuid;
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => operation(this.#owned(actor)));
    this.#queues.set(key, next);
    const cleanup = () => { if (this.#queues.get(key) === next) this.#queues.delete(key); };
    next.then(cleanup, cleanup);
    return next;
  }

  async #apply(actor, edits, { eventId } = {}) {
    const definitions = this.#definitions();
    const byId = new Map(definitions.map(d => [d.id, d]));
    for (const edit of edits) {
      if (!byId.has(edit.resourceId)) throw new Error(`Unknown resource: ${edit.resourceId}`);
      if (edit.amount != null && Math.abs(edit.amount) > 1_000_000) throw new Error("Resource delta is too large.");
    }
    const recentEvents = actor.getFlag(MODULE_ID, "recentEvents") ?? [];
    if (eventId && recentEvents.includes(eventId)) return { duplicate: true };
    if (eventId && (typeof eventId !== "string" || eventId.length > 500)) throw new Error("Invalid event ID.");
    const states = actor.getFlag(MODULE_ID, "resources") ?? {};
    const changes = [];
    // Aggregate same-resource rules to avoid multiple reset cycles from one attack.
    const grouped = new Map();
    for (const edit of edits) {
      const group = grouped.get(edit.resourceId) ?? { amount: 0 };
      if (edit.value != null) group.value = numeric(edit.value);
      else group.amount += edit.amount;
      grouped.set(edit.resourceId, group);
    }
    for (const [resourceId, edit] of grouped) {
      const definition = byId.get(resourceId);
      const state = this.#state(states[resourceId]);
      if (!state.enabled) continue;
      const result = transition(definition, state, edit.value ?? state.value + edit.amount);
      states[resourceId] = result.state;
      changes.push({ definition, ...result });
    }
    // Prepare all status data before changing any documents; invalid statuses cannot consume history.
    const additions = [];
    const deletions = new Set();
    for (const { definition, activate, deactivate } of changes) {
      for (const threshold of deactivate) {
        for (const effect of managedEffects(actor, definition.id, threshold.id)) deletions.add(effect.id);
      }
      for (const threshold of activate) {
        if (managedEffects(actor, definition.id, threshold.id).length) continue;
        const effect = await buildEffect(definition, threshold, this.statusEffect, this.worldTime());
        if (effect) additions.push(effect);
      }
    }
    if (additions.length) await actor.createEmbeddedDocuments("ActiveEffect", additions);
    if (deletions.size) await actor.deleteEmbeddedDocuments("ActiveEffect", [...deletions]);
    const update = { [`flags.${MODULE_ID}.resources`]: states };
    if (eventId) update[`flags.${MODULE_ID}.recentEvents`] = [...recentEvents, eventId].slice(-200);
    await actor.update(update);
    return { resources: states, changes };
  }
}
