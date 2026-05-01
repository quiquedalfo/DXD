import type { StatKey } from "../types/index.js";

const DEFAULT_LABELS: Record<StatKey, string> = {
  brains: "Brains",
  brawn: "Brawn",
  fight: "Fight",
  flight: "Flight",
  charm: "Charm",
  grit: "Grit",
};

/**
 * Etiqueta visible: prioriza la del personaje (`stat_label` en DB) y cae al default Kids on Bikes.
 */
export function mapVisibleStatLabel(statKey: StatKey, statLabelFromCharacter: string | null | undefined): string {
  const trimmed = (statLabelFromCharacter ?? "").trim();
  if (trimmed.length > 0) return trimmed;
  return DEFAULT_LABELS[statKey];
}
