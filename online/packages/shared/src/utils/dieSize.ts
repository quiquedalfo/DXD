import type { DieSize } from "../types/index.js";

/** Valor almacenado en Postgres (`public.die_size` enum). */
export type DieSizeDb = "4" | "6" | "8" | "10" | "12" | "20";

export function dieSizeToDb(value: DieSize): DieSizeDb {
  return String(value) as DieSizeDb;
}

export function dieSizeFromDb(value: string): DieSize {
  const n = Number(value);
  if (n === 4 || n === 6 || n === 8 || n === 10 || n === 12 || n === 20) {
    return n;
  }
  return 20;
}
