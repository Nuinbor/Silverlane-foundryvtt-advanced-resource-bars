import { MODULE_ID } from "../scripts/domain.mjs";

export function actorFixture({ uuid = "Actor.hero", owner = true } = {}) {
  const actor = {
    documentName: "Actor", uuid, id: uuid.split(".").at(-1), name: "Hero", isOwner: owner,
    flags: {}, effects: [], updates: [], ownership: { default: 0, player: owner ? 3 : 0 }, nextEffectId: 0,
    testUserPermission(user) { return Boolean(user?.isGM || (this.ownership[user?.id] ?? this.ownership.default) >= 3); },
    getFlag(scope, key) { return this.flags[scope]?.[key]; },
    async update(update) {
      this.updates.push(structuredClone(update));
      for (const [path, value] of Object.entries(update)) {
        const keys = path.split(".");
        let cursor = this;
        for (const key of keys.slice(0, -1)) cursor = cursor[key] ??= {};
        cursor[keys.at(-1)] = structuredClone(value);
      }
      return this;
    },
    async createEmbeddedDocuments(type, data, options = {}) {
      if (type !== "ActiveEffect") throw new Error("Wrong document type");
      const docs = data.map(effect => {
        const id = options.keepId && effect._id ? effect._id : `effect-${this.nextEffectId++}`;
        return { ...structuredClone(effect), _id: id, id };
      });
      this.effects.push(...docs);
      return docs;
    },
    async deleteEmbeddedDocuments(type, ids) {
      if (type !== "ActiveEffect") throw new Error("Wrong document type");
      this.effects = this.effects.filter(e => !ids.includes(e.id));
    }
  };
  return actor;
}

export const stateOf = actor => actor.flags[MODULE_ID]?.resources?.["nerve-damage"];
export const statusFixture = async status => {
  if (status !== "paralyzed") throw new Error(`Unknown status: ${status}`);
  return { name: "Paralyzed", type: "condition", img: "icons/paralysis.svg", statuses: [status], system: { type: status, special: true, changes: [] }, start: null };
};
