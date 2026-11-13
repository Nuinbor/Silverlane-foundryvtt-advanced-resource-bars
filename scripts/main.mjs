import { MODULE_ID, defaultDefinitions, validateDefinitions } from "./domain.mjs";
import { ResourceService } from "./service.mjs";
import { CombatIntegration } from "./combat.mjs";
import { ResourceTracker, ResourceConfig, ItemRulesConfig, uiAction } from "./ui.mjs";
import { drawTokenBars } from "./token-bars.mjs";

let service;
let combat;
let tracker;

const tr = key => game.i18n.localize(`SRB.${key}`);
const definitions = () => validateDefinitions(game.settings.get(MODULE_ID, "definitions"));
const automation = () => game.settings.get(MODULE_ID, "automation");

function selectedActors() {
  const actors = new Map();
  for (const token of globalThis.canvas?.tokens?.controlled ?? []) if (token.actor?.isOwner) actors.set(token.actor.uuid, token.actor);
  if (!actors.size && game.user.character?.isOwner) actors.set(game.user.character.uuid, game.user.character);
  return [...actors.values()];
}

function refreshBars(token) {
  if (!globalThis.canvas?.ready || !service) return;
  const list = token ? [token] : canvas.tokens?.placeables ?? [];
  for (const entry of list) drawTokenBars(entry, definitions(), game.settings.get(MODULE_ID, "tokenBars"), game.user);
}

function refreshAll() {
  if (tracker?.rendered) tracker.render({ force: true });
  refreshBars();
}

async function asActor(input) {
  const document = typeof input === "string" ? await fromUuid(input) : input;
  return document?.documentName === "Actor" ? document : document?.actor ?? document?.document?.actor;
}

function configure() {
  if (!game.user.isGM) throw new Error(tr("GMOnly"));
  return new ResourceConfig().render({ force: true });
}

async function open(input) {
  const actors = input == null ? selectedActors() : await Promise.all((Array.isArray(input) ? input : [input]).map(asActor));
  for (const actor of actors) service.get(actor); // Validate ownership before rendering anything.
  if (!tracker || !tracker.rendered) tracker = new ResourceTracker({ actors, service, resolveActors: selectedActors, configure });
  else tracker.actors = actors;
  return tracker.render({ force: true });
}

async function configureItem(item) {
  if (!game.user.isGM) throw new Error(tr("GMOnly"));
  if (typeof item === "string") item = await fromUuid(item);
  if (item?.documentName !== "Item" || !item.isOwner) throw new Error(tr("InvalidItem"));
  return new ItemRulesConfig(item, { id: `silverlane-item-rules-${item.id}` }).render({ force: true });
}

function addSheetAction(app, element) {
  const document = app.document;
  if (!["Actor", "Item"].includes(document?.documentName) || !document.isOwner || (document.documentName === "Item" && !game.user.isGM)) return;
  // v14 supplies the inner render fragment; the window header belongs to the outer frame.
  const header = app.element?.querySelector(".window-header") ?? element?.querySelector?.(".window-header");
  if (!header || header.querySelector(".srb-sheet-button")) return;
  const button = document.documentName === "Actor" ? "Tracker" : "AttackRules";
  const node = globalThis.document.createElement("button");
  node.type = "button";
  node.className = "srb-sheet-button header-control";
  node.title = tr(button);
  node.setAttribute("aria-label", tr(button));
  const icon = globalThis.document.createElement("i");
  icon.className = "fa-solid fa-bars-progress";
  node.append(icon);
  node.addEventListener("click", event => {
    event.preventDefault();
    uiAction(() => document.documentName === "Actor" ? open(document) : configureItem(document));
  });
  header.insertBefore(node, header.querySelector('[data-action="close"]'));
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "definitions", { scope: "world", config: false, type: Array, default: defaultDefinitions(), onChange: refreshAll });
  game.settings.registerMenu(MODULE_ID, "resourceConfig", {
    name: "SRB.Configure", label: "SRB.Configure", hint: "SRB.ConfigHint", icon: "fa-solid fa-sliders", type: ResourceConfig, restricted: true
  });
  game.settings.register(MODULE_ID, "automation", {
    name: "SRB.Automation", hint: "SRB.AutomationHint", scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, "tokenBars", {
    name: "SRB.TokenBars", hint: "SRB.TokenBarsHint", scope: "client", config: true, type: String, default: "controlled", onChange: refreshAll,
    choices: { controlled: "SRB.Controlled", hover: "SRB.Hover", always: "SRB.Always", none: "SRB.None" }
  });
  service = new ResourceService({
    definitions,
    statusEffect: async status => (await CONFIG.ActiveEffect.documentClass.fromStatusEffect(status)).toObject()
  });
  combat = new CombatIntegration({ service, game });
  game.modules.get(MODULE_ID).api = Object.freeze({
    open, configure, configureItem,
    get: actor => service.get(typeof actor === "string" ? fromUuidSync(actor) : actor),
    set: (...args) => service.set(...args), adjust: (...args) => service.adjust(...args),
    reset: (...args) => service.reset(...args), setEnabled: (...args) => service.setEnabled(...args),
    applyItem: (item, targets = game.user.targets, options) => combat.applyItem(item, targets, options),
    applyOnHit: (item, targets = game.user.targets, options = {}) => combat.applyItem(item, targets, { ...options, trigger: "hit" }),
    definitions: () => structuredClone(definitions())
  });
  game.keybindings.register(MODULE_ID, "tracker", {
    name: "SRB.Tracker", editable: [{ key: "KeyR", modifiers: ["Alt"] }],
    onDown: () => { uiAction(() => open()); return true; }
  });
});

Hooks.once("ready", () => {
  if (game.system.id !== "dnd5e") ui.notifications.warn(tr("WrongSystem"));
  console.info(`${MODULE_ID} | Ready. Macro: game.modules.get("${MODULE_ID}").api.open()`);
});

Hooks.on("createChatMessage", message => { if (automation()) return uiAction(() => combat.onAttackMessage(message)); });
Hooks.on("updateChatMessage", message => { if (automation()) return uiAction(() => combat.onAttackMessage(message)); });
Hooks.on("dnd5e.applyDamage", (actor, amount, options) => { if (automation()) return uiAction(() => combat.onDamage(actor, amount, options)); });
Hooks.on("midi-qol.RollComplete", workflow => { if (automation()) return uiAction(() => combat.onMidiComplete(workflow)); });
Hooks.on("renderApplicationV2", addSheetAction);
Hooks.on("updateActor", refreshAll);
Hooks.on("updateToken", refreshAll);
Hooks.on("createActiveEffect", refreshAll);
Hooks.on("deleteActiveEffect", refreshAll);
Hooks.on("canvasReady", () => refreshBars());
Hooks.on("refreshToken", token => refreshBars(token));
Hooks.on("controlToken", token => refreshBars(token));
Hooks.on("hoverToken", token => refreshBars(token));
