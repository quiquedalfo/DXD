/**
 * Resolución de checks alineada al RPC `submit_check_response` (total = dado + fichas + mod manual).
 * Explosión `spec` = regla documentada (dado ≥ cara); `desktop` = cadena como el cliente Python / Excel DXD.
 * Fichas en mesa (RPC): éxito sin gasto declarado = sin cambio; éxito con fichas = descuenta solo esas; fallo = −gasto +1.
 */
import type { DieSize } from "../types/index.js";

export type CheckOutcome = "pass" | "fail";

export type ExplosionRule =
  /** Regla del documento pegado: `roll_value >= die_size` (ojo: en d20, 20>=20 es true). */
  | "spec_roll_gte_die_size"
  /**
   * Alineación con el desktop actual (`core/dice.py::roll_explosion_chain`):
   * la cadena de explosión se dispara cuando `roll_value + tokens_spent === die_size`.
   * Útil si el MVP móvil debe comportarse igual que el Excel/Python.
   */
  | "desktop_roll_plus_tokens_eq_max";

export type ResolveCheckInput = {
  dieSize: DieSize;
  rollValue: number;
  tokensSpent: number;
  modifierApplied: number;
  targetCheckValue: number;
  explosionRule?: ExplosionRule;
};

export type ResolveCheckOutput = {
  computedTotal: number;
  outcome: CheckOutcome;
  margin: number;
  explosionFlag: boolean;
};

function explosionFromSpec(rollValue: number, dieSize: number): boolean {
  return rollValue >= dieSize;
}

function explosionFromDesktop(rollValue: number, tokensSpent: number, dieSize: number): boolean {
  return rollValue + tokensSpent === dieSize;
}

/**
 * Resolución pura de una respuesta de check (sin I/O).
 * Centralizar acá toda variante de explosión / total.
 */
export function resolveCheck(input: ResolveCheckInput): ResolveCheckOutput {
  const rule = input.explosionRule ?? "spec_roll_gte_die_size";
  const computedTotal =
    input.rollValue + input.tokensSpent + input.modifierApplied;
  const outcome: CheckOutcome =
    computedTotal >= input.targetCheckValue ? "pass" : "fail";
  const margin = computedTotal - input.targetCheckValue;
  const explosionFlag =
    rule === "desktop_roll_plus_tokens_eq_max"
      ? explosionFromDesktop(input.rollValue, input.tokensSpent, input.dieSize)
      : explosionFromSpec(input.rollValue, input.dieSize);

  return { computedTotal, outcome, margin, explosionFlag };
}
