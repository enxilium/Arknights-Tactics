import type { SkillInfo, SkillTiming } from "./data-types.ts";

export type SkillLevel = {
  name: string;
  description?: string;
  duration?: number;
  durationType?: string;
  skillType?: string;
  blackboard?: { key: string; value: number; valueStr?: string | null }[];
};

export function skillDescription(level: SkillLevel): string {
  const values = new Map(
    (level.blackboard ?? []).map((entry) => [entry.key.toLowerCase(), entry]),
  );
  return (level.description ?? "")
    .replace(
      /\{(-?)([^}:]+)(?::([^}]+))?\}/g,
      (placeholder, sign, key, format = "") => {
        const entry = values.get(key.toLowerCase());
        if (!entry) return placeholder;
        if (entry.valueStr) return entry.valueStr;
        if (!Number.isFinite(entry.value)) return placeholder;
        let value = entry.value * (sign ? -1 : 1);
        if (format.includes("%")) value *= 100;
        const precision = format.includes(".")
          ? (format.match(/\.([0#]+)/)?.[1].length ?? 0)
          : format
            ? 0
            : 6;
        return `${Number(value.toFixed(Math.min(precision, 6)))}${format.includes("%") ? "%" : ""}`;
      },
    )
    .replace(/<[^>]*>/g, "")
    .trim();
}

export function skillTiming(
  level: SkillLevel,
  description = skillDescription(level),
): SkillTiming {
  if (level.skillType === "PASSIVE") return { kind: "passive" };
  // AMMO takes priority: many ammo skills have a numeric duration of 0 or -1.
  if (level.durationType === "AMMO") {
    const entry = level.blackboard?.find((value) =>
      /(?:^|[@.])(?:s\d[_.]?)?trigger_time$/.test(value.key),
    );
    const literal = description.match(
      /(?:grants|has)\s+(\d+)\s+(?:ammo|bullets)/i,
    );
    const amount = entry?.value ?? (literal ? Number(literal[1]) : null);
    const consumption = description.match(
      /each attack consumes\s+(\d+)\s+(?:ammo|bullets)/i,
    );
    return {
      kind: "ammo",
      ammo: amount && amount > 0 ? amount : null,
      perCycle:
        consumption && Number(consumption[1]) > 0 ? Number(consumption[1]) : 1,
    };
  }
  if (typeof level.duration !== "number" || !Number.isFinite(level.duration))
    return { kind: "unknown" };
  if (level.duration > 0) return { kind: "timed", seconds: level.duration };
  if (level.duration < 0) return { kind: "indefinite" };
  return { kind: "instant" };
}

export function skillInfo(id: string, levels: SkillLevel[] = []): SkillInfo {
  const level = levels.at(-1);
  if (!level)
    return {
      id,
      name: id,
      description: "Description unavailable from the source.",
      timing: { kind: "unknown" },
      levelLabel: "Unknown level",
      activation: "UNKNOWN",
    };
  const description = skillDescription(level);
  return {
    id,
    name: level.name || id,
    description,
    timing: skillTiming(level, description),
    levelLabel:
      levels.length <= 7 ? `Rank ${levels.length}` : `M${levels.length - 7}`,
    activation: level.skillType ?? "UNKNOWN",
  };
}
