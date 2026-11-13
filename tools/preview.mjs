// Static visual fixture only: this does not substitute for a licensed Foundry smoke test.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import Handlebars from "handlebars";
import { defaultDefinitions, MODULE_ID } from "../scripts/domain.mjs";

const definitions = defaultDefinitions();
definitions[0].thresholds[1].effect = "[[/damage 6d10 type=necrotic]]";
definitions.push({ ...structuredClone(definitions[0]), id: "blight", name: "Скверна", color: "#78b18b", thresholds: [] });
const translations = JSON.parse(await readFile("lang/ru.json", "utf8"));
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: Base => Base } } };
globalThis.game = {
  user: { isGM: true }, i18n: { localize: key => translations[key] ?? key },
  settings: { get: () => definitions }
};
globalThis.CONFIG = { statusEffects: { paralyzed: { id: "paralyzed", name: "Paralyzed" }, poisoned: { id: "poisoned", name: "Poisoned" } } };
Handlebars.registerHelper("localize", game.i18n.localize);
const { trackerContext, ResourceConfig, ItemRulesConfig } = await import("../scripts/ui.mjs");
const { ResourceManager } = await import("../scripts/manager.mjs");
const actor = { uuid: "Actor.hero", name: "Селена · следопыт", type: "character", isOwner: true, effects: [], getFlag: () => undefined };
const other = { ...actor, uuid: "Actor.mage", name: "Дарий · волшебник" };
const service = { get: actor => definitions.map(definition => ({ definition, state: { value: actor.uuid === "Actor.hero" ? 65 : 15, reached: ["warning"], enabled: true, cycles: 0 } })) };
game.actors = [actor, other];
game.modules = new Map([[MODULE_ID, { api: { ...service, definitions: () => definitions } }]]);
const tracker = trackerContext([actor], service, key => translations[`SRB.${key}`]);
const manager = await new ResourceManager({ service })._prepareContext();
const config = await new ResourceConfig()._prepareContext();
const item = { name: "Укус нейротоксичного паука", getFlag: (scope, key) => scope === MODULE_ID && key === "attackRules" ? [{ resourceId: "nerve-damage", amount: 5, trigger: "hit", activityId: "" }] : undefined, system: { activities: new Map([["bite", { id: "bite", name: "Укус" }]]) } };
const rules = await new ItemRulesConfig(item)._prepareContext();
async function panel(name, context, title, extra = "") {
  const html = Handlebars.compile(await readFile(`templates/${name}.hbs`, "utf8"))(context);
  return `<section class="srb ${extra}"><div class="preview-title">${title}</div><div class="window-content">${html}</div></section>`;
}
const css = await readFile("styles/resource-bars.css", "utf8");
const left = await panel("tracker", tracker, "Трекер ресурсов", "srb-tracker");
const right = await panel("resource-config", config, "Настройка шкал", "srb-config");
const bottom = await panel("item-rules", rules, "Ресурсы при атаке", "srb-config");
const table = await panel("manager", manager, "Менеджер шкал и эффектов", "srb-manager");
await mkdir("dist", { recursive: true });
await writeFile("dist/preview.html", `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Silverlane UI preview</title><style>
*{box-sizing:border-box}body{margin:24px;background:#101119;font:14px system-ui;color:#efedf6}button,input,select,textarea{font:inherit}button{cursor:pointer}input,select{height:32px}h1{font-size:22px;margin:0 0 24px}.layout{display:grid;grid-template-columns:430px 940px;gap:24px;align-items:start}.srb{border:1px solid #454253;border-radius:9px;overflow:hidden}.preview-title{background:#30303e;padding:12px 16px;font-weight:600}.left{display:flex;flex-direction:column;gap:24px}.srb .window-content{padding:16px}.srb-manager{margin-bottom:24px;width:1394px}.srb-manager .window-content{height:400px}${css}</style><h1>Silverlane · Advanced Resource Bars</h1>${table}<div class="layout"><div class="left">${left}${bottom}</div>${right}</div></html>`);
console.log("Static preview: dist/preview.html");
