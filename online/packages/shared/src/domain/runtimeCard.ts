import type { CharacterRow, CharacterRuntimeRow, CharacterStatRow, StatKey } from "../types/index.js";
import { mapVisibleStatLabel } from "./statLabels.js";

export type RuntimeStatLine = {
  statKey: StatKey;
  label: string;
  dieSize: number;
  baseModifier: number;
};

export type RuntimeCardData = {
  characterName: string;
  avatarUrl: string | null;
  stats: RuntimeStatLine[];
  currentTokens: number;
  currentModifier: number;
  sceneText: string | null;
  checkStatus: CharacterRuntimeRow["check_status"];
  lastRollValue: number | null;
  lastTotalValue: number | null;
  lastResult: CharacterRuntimeRow["last_result"];
  lastMargin: number | null;
};

/**
 * Ensambla el view-model de la “ficha viva” del jugador (presentación separada de persistencia).
 */
export function buildRuntimeCardData(input: {
  character: Pick<CharacterRow, "name" | "avatar_url">;
  stats: Pick<CharacterStatRow, "stat_key" | "stat_label" | "die_size" | "base_modifier">[];
  runtime: Pick<
    CharacterRuntimeRow,
    | "current_tokens"
    | "current_modifier"
    | "check_status"
    | "last_roll_value"
    | "last_total_value"
    | "last_result"
    | "last_margin"
  >;
  sceneText: string | null;
}): RuntimeCardData {
  const stats = input.stats.map((s) => ({
    statKey: s.stat_key,
    label: mapVisibleStatLabel(s.stat_key, s.stat_label),
    dieSize: s.die_size,
    baseModifier: s.base_modifier,
  }));

  return {
    characterName: input.character.name,
    avatarUrl: input.character.avatar_url,
    stats,
    currentTokens: input.runtime.current_tokens,
    currentModifier: input.runtime.current_modifier,
    sceneText: input.sceneText,
    checkStatus: input.runtime.check_status,
    lastRollValue: input.runtime.last_roll_value,
    lastTotalValue: input.runtime.last_total_value,
    lastResult: input.runtime.last_result,
    lastMargin: input.runtime.last_margin,
  };
}
