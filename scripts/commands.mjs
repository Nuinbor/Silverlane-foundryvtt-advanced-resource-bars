const DAMAGE_TYPES = new Set(["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"]);

/** A deliberately small, documented subset of native chat syntax; never scripts or macros. */
export function parseEffectCommand(input = "") {
  if (typeof input !== "string" || input.length > 500) throw new Error("Effect must be a single roll command, up to 500 characters.");
  let command = input.trim().replace(/[дД]/g, "d");
  if (!command) return null;
  if (/[\r\n]/.test(command)) throw new Error("Use one roll command per threshold.");
  if (command.startsWith("[[") && command.endsWith("]]")) command = command.slice(2, -2).trim();
  const match = command.match(/^\/(r|roll|damage)\s+(.+)$/i);
  if (command.startsWith("/") && !match) throw new Error("Supported commands: /r, /roll, /damage.");
  let formula = match ? match[2].trim() : command;
  let damageType = "";
  const typed = formula.match(/(?:\s+type=([a-z]+)|\s+([a-z]+)|\[([a-z]+)\])$/i);
  if (typed) {
    const type = (typed[1] ?? typed[2] ?? typed[3]).toLowerCase();
    if (!DAMAGE_TYPES.has(type)) throw new Error(`Unknown damage type: ${type}`);
    damageType = type;
    formula = formula.slice(0, typed.index).trim();
  }
  if (match?.[1].toLowerCase() === "damage" && !damageType) throw new Error("Damage commands need a type, for example: [[/damage 6d10 type=necrotic]].");
  if (!formula || !/^[\w@.\s+*/%()\-]+$/.test(formula)) throw new Error("Invalid roll formula.");
  let dice = 0;
  for (const match of formula.matchAll(/(\d*)d(\d+)/gi)) {
    dice += Number(match[1] || 1);
    if (Number(match[2]) < 1 || Number(match[2]) > 1_000_000 || dice > 1000) throw new Error("Roll is too large or has invalid dice.");
  }
  return { formula, damageType };
}
