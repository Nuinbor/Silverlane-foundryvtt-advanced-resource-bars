export const MODULE_ID = "silverlane-resource-bars";

const SAFE_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const RESERVED = new Set(["__proto__", "prototype", "constructor"]);
const CHANGE_TYPES = ["custom", "multiply", "add", "downgrade", "upgrade", "override"];

export function numeric(value) {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "" || !Number.isFinite(Number(value))) {
    throw new Error("A finite number is required.");
  }
  return Number(value);
}

function id(value) {
  if (typeof value !== "string" || !SAFE_ID.test(value) || RESERVED.has(value)) throw new Error(`Invalid ID: ${value}`);
  return value;
}

function text(value, fallback = "", max = 4000) {
  if (value == null) return fallback;
  if (typeof value !== "string" || value.length > max) throw new Error("Invalid text field.");
  return value;
}

export function normalizeEffectChanges(changes = []) {
  if (!Array.isArray(changes) || changes.length > 30) throw new Error("Invalid effect changes.");
  return changes.map(change => {
    const type = change.type ?? (Number.isInteger(change.mode) ? CHANGE_TYPES[change.mode] : undefined);
    const phase = change.phase ?? "initial";
    if (typeof change.key !== "string" || !/^system\.[a-zA-Z0-9_.-]+$/.test(change.key)
      || change.key.split(".").some(k => RESERVED.has(k)) || !CHANGE_TYPES.includes(type)
      || typeof phase !== "string" || !/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(phase)) {
      throw new Error("Effect changes require a safe system.* key and a valid v14 modifier type/phase.");
    }
    return { key: change.key, type, phase, value: text(String(change.value ?? ""), "", 1000), priority: change.priority == null ? null : numeric(change.priority) };
  });
}

export function validateDefinitions(input) {
  if (!Array.isArray(input) || input.length > 40) throw new Error("Expected up to 40 resource definitions.");
  const ids = new Set();
  return input.map(raw => {
    const resourceId = id(raw.id);
    if (ids.has(resourceId)) throw new Error(`Duplicate resource ID: ${resourceId}`);
    ids.add(resourceId);
    const max = numeric(raw.max);
    if (max <= 0 || max > 1_000_000) throw new Error("Maximum must be greater than zero and at most 1000000.");
    const color = raw.color ?? "#9b72cf";
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error("Color must be a six-digit hex color.");
    if (!Array.isArray(raw.thresholds) || raw.thresholds.length > 40) throw new Error("Expected up to 40 thresholds.");
    const thresholdIds = new Set();
    const thresholds = raw.thresholds.map(t => {
      const thresholdId = id(t.id);
      if (thresholdIds.has(thresholdId)) throw new Error(`Duplicate threshold ID: ${thresholdId}`);
      thresholdIds.add(thresholdId);
      const at = numeric(t.at);
      if (at <= 0 || at > max) throw new Error("Threshold must be greater than zero and no greater than maximum.");
      const mode = t.mode ?? "sticky";
      if (!["sticky", "current"].includes(mode)) throw new Error("Unknown threshold mode.");
      const normalizedChanges = normalizeEffectChanges(t.changes);
      const duration = t.duration == null || t.duration === "" ? 0 : numeric(t.duration);
      if (!Number.isInteger(duration) || duration < 0 || duration > 31_536_000) throw new Error("Duration must be whole seconds, from 0 to 31536000.");
      return {
        id: thresholdId, at, name: text(t.name, thresholdId, 120), description: text(t.description),
        mode, status: text(t.status, "", 100), changes: normalizedChanges, duration
      };
    }).sort((a, b) => a.at - b.at);
    return {
      id: resourceId, name: text(raw.name, resourceId, 120), description: text(raw.description),
      max, color, resetOnMax: raw.resetOnMax !== false, showOnToken: raw.showOnToken !== false, thresholds
    };
  });
}

export function defaultDefinitions() {
  return validateDefinitions([{
    id: "nerve-damage", name: "Поражение нервов", max: 100, color: "#a879e8",
    description: "Накопление поражения нервов. При 100: паралич и сброс шкалы в 0.",
    resetOnMax: true, showOnToken: true,
    thresholds: [
      { id: "warning", at: 20, name: "Нервный тремор", mode: "sticky", description: "Порог 20 достигнут. Мастер может настроить здесь статус или механический дебафф." },
      { id: "paralysis", at: 100, name: "Паралич", mode: "sticky", status: "paralyzed", description: "Paralyzed. Шкала сбрасывается в 0; состояние сохраняется до лечения или снятия эффекта." }
    ]
  }]);
}

/** Pure transition: history is independent of current-value effect activation. */
export function transition(definition, previous = {}, target) {
  const requested = Math.max(0, numeric(target));
  const before = Math.max(0, Number(previous.value) || 0);
  const rollover = definition.resetOnMax && requested >= definition.max;
  const value = rollover ? 0 : Math.min(requested, definition.max);
  const reached = new Set(Array.isArray(previous.reached) ? previous.reached : []);
  const activate = [];
  const deactivate = [];
  for (const threshold of definition.thresholds) {
    const touched = requested >= threshold.at;
    const terminal = rollover && threshold.at === definition.max;
    if (threshold.mode === "sticky") {
      if (terminal || (touched && !reached.has(threshold.id))) activate.push(threshold);
    } else {
      if ((value >= threshold.at && before < threshold.at) || terminal) activate.push(threshold);
      if (before >= threshold.at && value < threshold.at && !terminal) deactivate.push(threshold);
    }
    if (touched) reached.add(threshold.id);
  }
  return {
    state: { ...previous, value, reached: [...reached], cycles: (Number(previous.cycles) || 0) + Number(rollover) },
    activate, deactivate, rollover
  };
}
