// Static visual fixture only: this does not substitute for a licensed Foundry smoke test.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import Handlebars from "handlebars";
import { defaultDefinitions, MODULE_ID } from "../scripts/domain.mjs";

const definitions = defaultDefinitions();
const translations = JSON.parse(await readFile("lang/ru.json", "utf8"));
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: Base => Base } } };
globalThis.game = {
  user: { isGM: true }, i18n: { localize: key => translations[key] ?? key },
  settings: { get: () => definitions }
};
globalThis.CONFIG = { statusEffects: { paralyzed: { id: "paralyzed", name: "Paralyzed" }, poisoned: { id: "poisoned", name: "Poisoned" } } };
Handlebars.registerHelper("localize", game.i18n.localize);
const { trackerContext, ResourceConfig, ItemRulesConfig } = await import("../scripts/ui.mjs");
const actor = { uuid: "Actor.hero", name: "Селена · следопыт", isOwner: true };
const tracker = trackerContext([actor], { get: () => [{ definition: definitions[0], state: { value: 65, reached: ["warning"], enabled: true, cycles: 0 } }] }, key => translations[`SRB.${key}`]);
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
await mkdir("dist", { recursive: true });
await writeFile("dist/preview.html", `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Silverlane UI preview</title><style>
*{box-sizing:border-box}body{margin:32px;background:#101119;font:14px system-ui;color:#efedf6}button,input,select,textarea{font:inherit}button{cursor:pointer}input,select{height:32px}h1{font-size:22px;margin:0 0 24px}.layout{display:grid;grid-template-columns:450px 740px;gap:24px;align-items:start}.srb{border:1px solid #454253;border-radius:9px;overflow:hidden}.preview-title{background:#30303e;padding:12px 16px;font-weight:600}.left{display:flex;flex-direction:column;gap:24px}.srb .window-content{padding:16px}${css}</style><h1>Silverlane · Advanced Resource Bars</h1><div class="layout"><div class="left">${left}${bottom}</div>${right}</div></html>`);
console.log("Static preview: dist/preview.html");
