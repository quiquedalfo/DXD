"use client";

import { diceLabelForAria, diceSvgSrcForStat } from "./diceAssets";

type DiceBadgeProps = {
  /** Valor típico de `die_size`: "20", "d10", etc. */
  dieSizeRaw: string;
  className?: string;
};

/** Ícono de dado según tamaño (`/dice/d4.svg` … `d20.svg`). */
export function DiceBadge({ dieSizeRaw, className }: DiceBadgeProps) {
  const src = diceSvgSrcForStat(dieSizeRaw);
  const alt = diceLabelForAria(dieSizeRaw);

  return (
    <span className={className ? `mesa-dice-badge ${className}` : "mesa-dice-badge"} aria-hidden title={alt}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" width={144} height={144} decoding="async" draggable={false} />
    </span>
  );
}
