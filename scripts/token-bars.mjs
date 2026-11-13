import { MODULE_ID } from "./domain.mjs";

const overlays = new WeakMap();

export function tokenBarModel(token, definitions, mode, user) {
  if (mode === "none" || !token.actor?.isOwner || token.visible === false || (token.document?.hidden && !user.isGM)) return [];
  if (mode === "controlled" && !token.controlled) return [];
  if (mode === "hover" && !token.hover && !token.controlled) return [];
  const states = token.actor.getFlag(MODULE_ID, "resources") ?? {};
  return definitions.filter(d => d.showOnToken && states[d.id]?.enabled !== false).slice(0, 6).map(definition => ({
    ...definition, value: Math.min(definition.max, Math.max(0, Number(states[definition.id]?.value) || 0))
  }));
}

function rectangle(graphics, x, y, width, height, color, alpha = 1) {
  if (typeof graphics.roundRect === "function") graphics.roundRect(x, y, width, height, 2).fill({ color, alpha });
  else graphics.beginFill(color, alpha).drawRoundedRect(x, y, width, height, 2).endFill();
}

export function drawTokenBars(token, definitions, mode, user) {
  const rows = tokenBarModel(token, definitions, mode, user);
  const signature = JSON.stringify([rows, token.w, token.h]);
  const previous = overlays.get(token);
  if (previous?.signature === signature && previous.container.parent === token && !previous.container.destroyed) return;
  if (previous && !previous.container.destroyed) previous.container.destroy({ children: true });
  overlays.delete(token);
  if (!rows.length || token.destroyed || !token.w) return;
  const container = new PIXI.Container();
  container.eventMode = "none";
  const width = token.w;
  rows.forEach((row, index) => {
    const y = -(rows.length - index) * 21 - 4;
    const graphics = new PIXI.Graphics();
    rectangle(graphics, 0, y + 12, width, 6, 0x111118, 0.9);
    const filled = width * row.value / row.max;
    if (filled > 0) rectangle(graphics, 0, y + 12, filled, 6, Number.parseInt(row.color.slice(1), 16));
    for (const threshold of row.thresholds) {
      rectangle(graphics, Math.min(width - 1, width * threshold.at / row.max), y + 11, 1, 8, 0xffffff, 0.85);
    }
    container.addChild(graphics);
    const text = `${row.name}: ${row.value}/${row.max}`;
    const style = { fontFamily: "sans-serif", fontSize: Math.max(9, Math.min(12, width / 8)), fill: "#ffffff" };
    const label = Number.parseInt(PIXI.VERSION, 10) >= 8 ? new PIXI.Text({ text, style }) : new PIXI.Text(text, style);
    label.position.set(1, y);
    if (label.width > width) label.scale.set(width / label.width);
    container.addChild(label);
  });
  token.addChild(container);
  overlays.set(token, { signature, container });
}
