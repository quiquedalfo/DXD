/** Rutas públicas (`public/dice/*.svg`). */
const DIE_FACES = [4, 6, 8, 10, 12, 20] as const;

export type DieFace = (typeof DIE_FACES)[number];

/** Parsea tamaño de stat: "20", "d20", "D12" → 20. */
export function parseDieFaces(raw: string | null | undefined): DieFace | null {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^d/, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return (DIE_FACES as readonly number[]).includes(n) ? (n as DieFace) : null;
}

export function diceSvgSrcForStat(raw: string | null | undefined): string {
  const n = parseDieFaces(raw);
  if (n === null) return "/dice/d20.svg";
  return `/dice/d${n}.svg`;
}

export function diceLabelForAria(raw: string | null | undefined): string {
  const n = parseDieFaces(raw);
  return n === null ? "dado" : `d${n}`;
}
