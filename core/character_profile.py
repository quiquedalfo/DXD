"""
Perfil de personaje cargado desde BD (dado y TI/SI/MI por stat).
"""
from __future__ import annotations

import html
from dataclasses import dataclass
from typing import Any, Optional

from core.character_data import MODIFIER_VALUES, STATS


@dataclass
class CharacterProfile:
    id: int
    name: str
    portrait_filename: str  # vacío => intentar Imagenes/{nombre}.png
    dice: dict[str, str]
    mods: dict[str, Optional[str]]  # "TI" | "SI" | "MI" | None

    def dice_for(self, stat: str) -> str:
        return self.dice.get(stat, "D20")

    def mod_for(self, stat: str) -> int:
        key = self.mods.get(stat)
        if not key:
            return 0
        return int(MODIFIER_VALUES.get(key, 0))

    def mod_label(self, stat: str) -> str:
        key = self.mods.get(stat)
        if not key:
            return "—"
        bonus = MODIFIER_VALUES.get(key, 0)
        return f"{key} (+{bonus})"

    def stats_detail_html(self) -> str:
        """Resumen para panel lateral (HTML simple)."""
        name_e = html.escape(self.name)
        portrait = self.portrait_filename or f"(automático: {self.name}.png)"
        portrait_e = html.escape(portrait)
        rows = "".join(
            f"<tr><td>{html.escape(s)}</td><td>{html.escape(self.dice_for(s))}</td><td>{html.escape(self.mod_label(s))}</td></tr>"
            for s in STATS
        )
        return (
            f"<p style='margin-top:0'><b>{name_e}</b><br/>"
            f"<span style='color:#aaa;font-size:11px'>Retrato: {portrait_e}</span></p>"
            f"<table cellspacing='6' style='color:#e0e0e0'>"
            f"<tr style='color:#66ff66'><th>Stat</th><th>Dado</th><th>Mod</th></tr>{rows}</table>"
        )

    @staticmethod
    def from_db_row(row: dict[str, Any]) -> CharacterProfile:
        import json

        dice = json.loads(row["dice_json"])
        raw_mods = json.loads(row["mods_json"])
        mods: dict[str, Optional[str]] = {}
        for s in STATS:
            v = raw_mods.get(s)
            mods[s] = v if v in ("TI", "SI", "MI") else None
        return CharacterProfile(
            id=int(row["id"]),
            name=str(row["name"]),
            portrait_filename=str(row.get("portrait_filename") or ""),
            dice={s: str(dice.get(s, "D20")) for s in STATS},
            mods=mods,
        )
