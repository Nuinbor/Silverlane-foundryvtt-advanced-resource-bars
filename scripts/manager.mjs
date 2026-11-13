import { MODULE_ID, numeric } from "./domain.mjs";
import { ResourceTracker, trackerContext, uiAction } from "./ui.mjs";

export const resourceManagers = new Set();

export function managerActors(game, canvas, scope = "characters") {
  const candidates = scope === "characters" ? Array.from(game.actors ?? []).filter(a => a.type === "character")
    : (canvas?.tokens?.[scope === "selected" ? "controlled" : "placeables"] ?? []).map(t => t.actor);
  return [...new Map(candidates.filter(a => a?.isOwner).map(a => [a.uuid, a])).values()];
}

export class ResourceManager extends ResourceTracker {
  static DEFAULT_OPTIONS = {
    id: "silverlane-resource-manager", classes: ["srb", "srb-manager"],
    window: { title: "SRB.Manager", icon: "fa-solid fa-table-cells", resizable: true },
    position: { width: 1100, height: 650 },
    actions: { adjust: this.adjust, addResource: this.addResource, editResource: this.editResource, actorSheet: this.actorSheet }
  };
  static PARTS = { content: { template: `modules/${MODULE_ID}/templates/manager.hbs`, scrollable: [".srb-table-scroll"] } };

  constructor({ service, configure, ...options } = {}) {
    if (!game.user.isGM) throw new Error("Permission denied: the resource manager requires a GM.");
    const api = game.modules.get(MODULE_ID)?.api;
    super({ ...options, service: service ?? api, configure: configure ?? api?.configure });
    this.scope = "characters";
    this.delta = 5;
    this.search = "";
    resourceManagers.add(this);
  }

  async _prepareContext() {
    this.actors = managerActors(game, globalThis.canvas, this.scope).filter(a => a.name.toLowerCase().includes(this.search.toLowerCase()));
    const context = trackerContext(this.actors, this.service);
    const definitions = this.actors.length ? this.service.get(this.actors[0]).map(r => r.definition) : (game.modules.get(MODULE_ID)?.api?.definitions?.() ?? []);
    return { ...context, definitions, delta: this.delta, search: this.search,
      characters: this.scope === "characters", scene: this.scope === "scene", selected: this.scope === "selected" };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    for (const name of ["scope", "search", "delta"]) this.element.querySelector(`[name="${name}"]`)?.addEventListener("change", event => uiAction(async () => {
      this[name] = name === "delta" ? numeric(event.target.value) : event.target.value;
      this.render({ force: true });
    }));
  }

  static async adjust(event, target) {
    return uiAction(async () => {
      this.delta = numeric(this.element.querySelector('[name="delta"]').value);
      await this.service.adjust(target.dataset.actorUuid, target.dataset.resourceId, this.delta * Number(target.dataset.direction));
      this.render({ force: true });
    });
  }
  static addResource() { this.configureResources?.({ createNew: true }); }
  static editResource(event, target) { this.configureResources?.({ selectedId: target.dataset.resourceId }); }
  static actorSheet(event, target) {
    this.actors.find(a => a.uuid === target.dataset.actorUuid)?.sheet.render({ force: true });
  }

  _onClose(options) {
    resourceManagers.delete(this);
    return super._onClose(options);
  }
}
