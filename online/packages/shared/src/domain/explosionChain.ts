/**
 * Cadena de explosión (regla desktop): `dado + fichas === cara máxima` → hace falta otro segmento.
 * Alineado con `ui/character_panel.py::_compute_target_exo_row_count` y validación del RPC.
 */
export type ExplosionSegment = { roll: number; tokens: number };

/** Cuántas filas extra (post-tirada principal) debe mostrar la UI. */
export function computeRequiredExplosionRowCount(
  dieMax: number,
  mainRoll: number,
  mainTokens: number,
  exoRows: ExplosionSegment[],
): number {
  if (mainRoll + mainTokens !== dieMax) return 0;
  let target = 1;
  let i = 0;
  while (i < target) {
    if (i >= exoRows.length) break;
    const seg = exoRows[i];
    if (!seg) break;
    const { roll: d, tokens: f } = seg;
    if (d + f === dieMax) target = i + 2;
    i += 1;
  }
  return target;
}

/** Total del check: MOD una vez + suma de (dado+fichas) de cada segmento. */
export function computeExplosionChainDiceTotal(main: ExplosionSegment, extras: ExplosionSegment[]): number {
  let t = main.roll + main.tokens;
  for (const s of extras) {
    t += s.roll + s.tokens;
  }
  return t;
}

/** Total acumulado (MOD + dados) hasta la fila de explosión `rowIndex` (0-based). */
export function cumulativeThroughExoRow(
  modifier: number,
  main: ExplosionSegment,
  extras: ExplosionSegment[],
  rowIndex: number,
): number {
  let cum = modifier + main.roll + main.tokens;
  for (let i = 0; i <= rowIndex; i++) {
    const ex = extras[i];
    if (!ex) break;
    cum += ex.roll + ex.tokens;
  }
  return cum;
}

export function validateDesktopExplosionChain(dieMax: number, main: ExplosionSegment, extras: ExplosionSegment[]): string | null {
  if (main.roll < 1 || main.roll > dieMax || main.tokens < 0) {
    return "Revisá dado y fichas de la tirada principal.";
  }
  const sm = main.roll + main.tokens;
  if (sm !== dieMax && extras.length > 0) {
    return "Solo podés agregar tiradas extra si la principal explota (dado + fichas = cara máxima).";
  }
  if (sm === dieMax && extras.length === 0) {
    return "La tirada explota: completá la fila siguiente (dado y fichas).";
  }
  for (let i = 0; i < extras.length; i++) {
    const row = extras[i];
    if (!row) {
      return "Revisá dado y fichas en las tiradas de explosión.";
    }
    const { roll, tokens } = row;
    if (roll < 1 || roll > dieMax || tokens < 0) {
      return "Revisá dado y fichas en las tiradas de explosión.";
    }
    if (i < extras.length - 1) {
      if (roll + tokens !== dieMax) {
        return "Cada segmento que explota debe sumar la cara máxima antes de la siguiente fila.";
      }
    } else if (roll + tokens === dieMax) {
      return "Seguí completando la cadena hasta que deje de explotar.";
    }
  }
  return null;
}

/** Texto PASA/FALLA + margen; `explota` si algún segmento suma cara máxima (hay cadena o tirada máxima). */
export function explosionChainStatusLine(
  modifier: number,
  main: ExplosionSegment,
  extras: ExplosionSegment[],
  checkValue: number,
  dieMax: number,
): { line: string; explota: boolean } {
  const diceTotal = computeExplosionChainDiceTotal(main, extras);
  const total = modifier + diceTotal;
  const margin = total - checkValue;
  const pass = total >= checkValue;
  const explota =
    main.roll + main.tokens === dieMax || extras.some((s) => s.roll + s.tokens === dieMax);
  const pasaPart = pass ? `PASA +${margin}` : `FALLA ${margin}`;
  const boom = explota ? " · EXPLOTA" : "";
  return { line: `${pasaPart}${boom}`, explota };
}
