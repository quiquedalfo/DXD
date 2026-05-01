import type { StatTrainingTier } from "../types/index.js";

export const STAT_TRAINING_TIERS: readonly StatTrainingTier[] = [
  "none",
  "trained_in",
  "studied_in",
  "master_in",
] as const;

export function isStatTrainingTier(s: string): s is StatTrainingTier {
  return (STAT_TRAINING_TIERS as readonly string[]).includes(s);
}

/** Modificador que aporta solo el progreso de entrenamiento (sin base_modifier). */
export function trainingTierModifier(tier: string | null | undefined): number {
  if (!tier || !isStatTrainingTier(tier)) return 0;
  switch (tier) {
    case "trained_in":
      return 1;
    case "studied_in":
      return 3;
    case "master_in":
      return 5;
    default:
      return 0;
  }
}

export function nextTrainingTier(tier: StatTrainingTier): StatTrainingTier | null {
  switch (tier) {
    case "none":
      return "trained_in";
    case "trained_in":
      return "studied_in";
    case "studied_in":
      return "master_in";
    default:
      return null;
  }
}

/** Fichas que cuesta alcanzar el siguiente tier (trained=3, studied=4, master=5). */
export function tokenCostForNextTier(nextTier: StatTrainingTier): number | null {
  switch (nextTier) {
    case "trained_in":
      return 3;
    case "studied_in":
      return 4;
    case "master_in":
      return 5;
    default:
      return null;
  }
}

export function trainingTierShortLabel(tier: string | null | undefined): string {
  if (!tier || tier === "none") return "—";
  if (tier === "trained_in") return "T";
  if (tier === "studied_in") return "S";
  if (tier === "master_in") return "M";
  return "?";
}

export function trainingTierLongLabelEs(tier: string | null | undefined): string {
  if (!tier || tier === "none") return "Sin entreno";
  if (tier === "trained_in") return "Trained in";
  if (tier === "studied_in") return "Studied in";
  if (tier === "master_in") return "Master in";
  return tier;
}

/** Modificador total mostrado en hoja: base + entreno. */
export function effectiveStatModifier(baseModifier: number, trainingTier: string | null | undefined): number {
  return baseModifier + trainingTierModifier(trainingTier);
}
