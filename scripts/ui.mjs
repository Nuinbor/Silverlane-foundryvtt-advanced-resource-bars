import { MODULE_ID, defaultDefinitions, numeric, validateDefinitions } from "./domain.mjs";
import { validateItemRules } from "./combat.mjs";
import { managedEffects } from "./effects.mjs";
import { parseEffectCommand } from "./commands.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const tr = key => globalThis.game?.i18n?.localize(`SRB.${key}`) ?? key;
const template = name => `modules/${MODULE_ID}/templates/${name}.hbs`;

export async function uiAction(action) {
  try { return await action(); }
  catch (error) {
    console.error(`${MODULE_ID} |`, error);
    globalThis.ui?.notifications?.error(`${tr("Error")}: ${error.message}`);
  }
}

export function trackerContext(actors, service, localize = tr) {
  return {
    hasActors: actors.length > 0, isGM: globalThis.game?.user?.isGM ?? false,
    actors: actors.filter(actor => actor.isOwner).map(actor => ({
      uuid: actor.uuid, name: actor.name,
      pendingCount: actor.getFlag?.(MODULE_ID, "pendingActions")?.length ?? 0,
      resources: service.get(actor).map(({ definition, state }) => ({
        ...definition, ...state, actorUuid: actor.uuid,
        effects: managedEffects(actor, definition.id).map(effect => ({ id: effect.id, name: effect.name, disabled: Boolean(effect.disabled || effect.isSuppressed) })),
        percent: Math.min(100, Math.max(0, Number(state.value) / definition.max * 100)),
        thresholds: definition.thresholds.map(threshold => {
          const reached = state.reached.includes(threshold.id);
          const active = managedEffects(actor, definition.id, threshold.id).some(e => !e.disabled && !e.isSuppressed);
          const status = Object.values(globalThis.CONFIG?.statusEffects ?? {}).find(s => s.id === threshold.status);
          const statusLabel = status ? (globalThis.game?.i18n?.localize(status.name ?? status.label ?? status.id) ?? status.id) : threshold.status;
          const effectSummary = [statusLabel, threshold.effect, threshold.changes.length ? localize("CustomModifiers") : ""].filter(Boolean).join(" · ");
          return {
            ...threshold, reached, active, effectSummary, percent: threshold.at / definition.max * 100,
            tooltip: `${threshold.at}: ${threshold.name}\n${localize("Description")}: ${threshold.description}\n${localize("Effect")}: ${effectSummary || "—"}\n${localize(reached ? "Reached" : "NotReached")}${active ? ` · ${localize("Active")}` : ""}`
          };
        })
      }))
    }))
  };
}

export function readDefinitionForm(form, resourceId) {
  const value = name => form.querySelector(`[name="${name}"]`)?.value ?? "";
  return validateDefinitions([{
    id: resourceId, name: value("name"), max: numeric(value("max")), color: value("color"), description: value("description"),
    resetOnMax: Boolean(form.querySelector('[name="resetOnMax"]')?.checked),
    showOnToken: Boolean(form.querySelector('[name="showOnToken"]')?.checked),
    thresholds: [...form.querySelectorAll("section[data-threshold-id]")].map(row => {
      const read = name => row.querySelector(`[name="${name}"]`)?.value ?? "";
      return {
        id: row.dataset.thresholdId, name: read("thresholdName"), at: numeric(read("at")), mode: read("mode"), status: read("status"),
        description: read("thresholdDescription"), duration: numeric(read("duration") || 0), changes: JSON.parse(read("changes") || "[]"),
        effect: read("thresholdEffect"), autoDamage: row.querySelector('[name="autoDamage"]')?.checked ?? true
      };
    })
  }])[0];
}

export function readItemRulesForm(form) {
  return validateItemRules([...form.querySelectorAll("[data-rule-index]")].map(row => {
    const read = name => row.querySelector(`[name="${name}"]`)?.value ?? "";
    return { resourceId: read("resourceId"), amount: numeric(read("amount")), trigger: read("trigger"), activityId: read("activityId") };
  }));
}

function requireGM() {
  if (!game.user.isGM) throw new Error("Permission denied: configuration requires a GM.");
}

function freshId(prefix) {
  return `${prefix}-${foundry.utils.randomID(10).toLowerCase()}`;
}

export class ResourceTracker extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "silverlane-resource-tracker", classes: ["srb", "srb-tracker"],
    window: { title: "SRB.Tracker", icon: "fa-solid fa-bars-progress", resizable: true },
    position: { width: 460, height: "auto" },
    actions: {
      adjust: this.adjust, reset: this.reset, treat: this.treat, configure: this.configure, refresh: this.refresh,
      removeEffect: this.removeEffect, retryActions: this.retryActions, manager: this.manager
    }
  };
  static PARTS = { content: { template: template("tracker") } };

  constructor({ actors = [], service, resolveActors, configure, manager, ...options } = {}) {
    super(options);
    Object.assign(this, { actors, service, resolveActors, configureResources: configure, openManager: manager });
  }

  async _prepareContext() { return trackerContext(this.actors, this.service); }

  _onRender(context, options) {
    super._onRender(context, options);
    for (const input of this.element.querySelectorAll("[data-edit-value]")) {
      input.addEventListener("change", () => uiAction(async () => {
        await this.service.set(input.dataset.actorUuid, input.dataset.resourceId, input.value);
        this.render({ force: true });
      }));
    }
    for (const input of this.element.querySelectorAll("[data-enable-resource]")) {
      input.addEventListener("change", () => uiAction(async () => {
        await this.service.setEnabled(input.dataset.actorUuid, input.dataset.resourceId, input.checked);
        this.render({ force: true });
      }));
    }
  }

  static async adjust(event, target) {
    return uiAction(async () => {
      await this.service.adjust(target.dataset.actorUuid, target.dataset.resourceId, Number(target.dataset.amount));
      this.render({ force: true });
    });
  }

  static async reset(event, target) {
    return uiAction(async () => {
      await this.service.reset(target.dataset.actorUuid, target.dataset.resourceId);
      this.render({ force: true });
    });
  }

  static async treat(event, target) {
    return uiAction(async () => {
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: tr("Treat") }, content: `<p>${tr("TreatConfirm")}</p>`
      });
      if (!confirmed) return;
      await this.service.reset(target.dataset.actorUuid, target.dataset.resourceId, { clearHistory: true });
      this.render({ force: true });
    });
  }

  static configure() { this.configureResources?.(); }
  static manager() { this.openManager?.(); }
  static async removeEffect(event, target) {
    return uiAction(async () => {
      await this.service.removeEffect(target.dataset.actorUuid, target.dataset.effectId);
      this.render({ force: true });
    });
  }
  static async retryActions(event, target) {
    return uiAction(async () => {
      await this.service.retryActions(target.dataset.actorUuid);
      this.render({ force: true });
    });
  }
  static refresh() {
    if (this.resolveActors) this.actors = this.resolveActors();
    this.render({ force: true });
  }
}

export class ResourceConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "silverlane-resource-config", tag: "form", classes: ["srb", "srb-config"],
    window: { title: "SRB.Configure", icon: "fa-solid fa-sliders", resizable: true },
    position: { width: 940, height: 760 },
    form: { closeOnSubmit: false, handler: this.submit },
    actions: { addResource: this.addResource, removeResource: this.removeResource, addThreshold: this.addThreshold, removeThreshold: this.removeThreshold,
      selectResource: this.selectResource, presetNecrotic: this.presetNecrotic }
  };
  static PARTS = { content: { template: template("resource-config") } };

  constructor({ selectedId, createNew = false, ...options } = {}) {
    super(options);
    requireGM();
    this.draft = validateDefinitions(game.settings.get(MODULE_ID, "definitions"));
    this.selectedId = this.draft.some(d => d.id === selectedId) ? selectedId : this.draft[0]?.id;
    if (createNew) this.newResource();
  }

  async _prepareContext() {
    const selected = this.draft.find(d => d.id === this.selectedId);
    const statuses = Object.values(CONFIG.statusEffects).map(status => ({ id: status.id, label: game.i18n.localize(status.name ?? status.label ?? status.id) }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return {
      resources: this.draft.map(d => ({ ...d, selected: d.id === this.selectedId })),
      selected: selected ? { ...selected, thresholds: selected.thresholds.map(t => ({
        ...t, sticky: t.mode === "sticky", current: t.mode === "current", changesJson: JSON.stringify(t.changes, null, 2),
        statuses: statuses.map(status => ({ ...status, selected: status.id === t.status }))
      })) } : null
    };
  }

  syncDraft() {
    const index = this.draft.findIndex(d => d.id === this.selectedId);
    if (index >= 0 && this.element?.querySelector('[name="name"]')) this.draft[index] = readDefinitionForm(this.element, this.selectedId);
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector('[name="selectedResource"]')?.addEventListener("change", event => uiAction(async () => {
      const next = event.target.value;
      try { this.syncDraft(); }
      catch (error) { event.target.value = this.selectedId; throw error; }
      this.selectedId = next;
      this.render({ force: true });
    }));
  }

  static async submit() {
    return uiAction(async () => {
      requireGM();
      this.syncDraft();
      const definitions = validateDefinitions(this.draft);
      for (const def of definitions) for (const threshold of def.thresholds) {
        if (threshold.status && !Object.values(CONFIG.statusEffects).some(s => s.id === threshold.status)) throw new Error(`Unknown status: ${threshold.status}`);
        const command = parseEffectCommand(threshold.effect);
        if (command && globalThis.Roll?.validate && !Roll.validate(command.formula)) throw new Error(`Invalid roll formula: ${command.formula}`);
      }
      await game.settings.set(MODULE_ID, "definitions", definitions);
      ui.notifications.info(tr("Saved"));
      await this.close();
    });
  }

  static addResource() {
    return uiAction(async () => {
      this.syncDraft();
      this.newResource();
      this.render({ force: true });
    });
  }

  newResource() {
    if (this.draft.length >= 40) throw new Error("A maximum of 40 resources is supported.");
    const base = defaultDefinitions()[0];
    this.selectedId = freshId("resource");
    this.draft.push({ ...base, id: this.selectedId, name: tr("NewResource"), description: "", thresholds: [] });
  }

  static selectResource(event, target) {
    return uiAction(async () => {
      this.syncDraft();
      this.selectedId = target.dataset.resourceId;
      this.render({ force: true });
    });
  }

  static presetNecrotic(event, target) {
    const row = target.closest("section[data-threshold-id]");
    row.querySelector('[name="thresholdEffect"]').value = "[[/damage 6d10 type=necrotic]]";
  }

  static removeResource() {
    return uiAction(async () => {
      if (!await foundry.applications.api.DialogV2.confirm({ window: { title: tr("Delete") }, content: `<p>${tr("DeleteResourceConfirm")}</p>` })) return;
      this.draft = this.draft.filter(d => d.id !== this.selectedId);
      this.selectedId = this.draft[0]?.id;
      this.render({ force: true });
    });
  }

  static addThreshold() {
    return uiAction(async () => {
      this.syncDraft();
      this.draft.find(d => d.id === this.selectedId)?.thresholds.push({
        id: freshId("threshold"), at: Math.min(20, this.draft.find(d => d.id === this.selectedId).max), name: tr("NewThreshold"), description: "", mode: "sticky", status: "", changes: [], duration: 0,
        effect: "", autoDamage: true
      });
      this.render({ force: true });
    });
  }

  static removeThreshold(event, target) {
    return uiAction(async () => {
      this.syncDraft();
      const selected = this.draft.find(d => d.id === this.selectedId);
      selected.thresholds = selected.thresholds.filter(t => t.id !== target.dataset.thresholdId);
      this.render({ force: true });
    });
  }
}

export class ItemRulesConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "silverlane-item-rules", tag: "form", classes: ["srb", "srb-config"],
    window: { title: "SRB.AttackRules", icon: "fa-solid fa-burst", resizable: true },
    position: { width: 720, height: "auto" }, form: { closeOnSubmit: false, handler: this.submit },
    actions: { addRule: this.addRule, removeRule: this.removeRule }
  };
  static PARTS = { content: { template: template("item-rules") } };

  constructor(item, options = {}) {
    super(options);
    requireGM();
    this.item = item;
    this.rules = validateItemRules(item.getFlag(MODULE_ID, "attackRules") ?? []);
  }

  async _prepareContext() {
    const definitions = validateDefinitions(game.settings.get(MODULE_ID, "definitions"));
    const activities = Array.from(this.item.system.activities?.values() ?? []);
    return {
      itemName: this.item.name, hasResources: definitions.length > 0,
      rules: this.rules.map((rule, index) => ({
        ...rule, index,
        resources: definitions.map(d => ({ id: d.id, name: d.name, selected: d.id === rule.resourceId })),
        activities: activities.map(a => ({ id: a.id, name: a.name, selected: a.id === rule.activityId })),
        hit: rule.trigger === "hit", damage: rule.trigger === "damage", manual: rule.trigger === "manual"
      }))
    };
  }

  syncRules() { if (this.element) this.rules = readItemRulesForm(this.element); }

  static addRule() {
    return uiAction(async () => {
      this.syncRules();
      const [definition] = validateDefinitions(game.settings.get(MODULE_ID, "definitions"));
      if (!definition) throw new Error(tr("NoResources"));
      this.rules.push({ resourceId: definition.id, amount: 5, trigger: "hit", activityId: "" });
      this.render({ force: true });
    });
  }

  static removeRule(event, target) {
    return uiAction(async () => {
      this.syncRules();
      this.rules.splice(Number(target.dataset.index), 1);
      this.render({ force: true });
    });
  }

  static async submit() {
    return uiAction(async () => {
      requireGM();
      this.syncRules();
      const resources = new Set(game.settings.get(MODULE_ID, "definitions").map(d => d.id));
      for (const rule of this.rules) if (!resources.has(rule.resourceId)) throw new Error(`Unknown resource: ${rule.resourceId}`);
      await this.item.setFlag(MODULE_ID, "attackRules", validateItemRules(this.rules));
      ui.notifications.info(tr("Saved"));
      await this.close();
    });
  }
}
