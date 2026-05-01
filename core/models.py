"""
Modelos de dominio para tiradas e historial (independientes de la UI).
Claves internas de stat estables; etiquetas de pantalla vía STAT_LABELS.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

# Claves internas estables (especificación migración Excel → Python).
# Online (Supabase): mismo conjunto; el enum `stat_key` ordena `brains` primero — solo presentación.
STAT_KEYS = ("brawn", "brains", "fight", "flight", "charm", "grit")

# Excel/UI histórico usa "Brains", "Charm", etc.
_DISPLAY_TO_KEY = {
    "brawn": "brawn",
    "brains": "brains",
    "brain": "brains",
    "fight": "fight",
    "flight": "flight",
    "charm": "charm",
    "char": "charm",
    "grit": "grit",
    "Brawn": "brawn",
    "Brains": "brains",
    "Brain": "brains",
    "Fight": "fight",
    "Flight": "flight",
    "Charm": "charm",
    "Char": "charm",
    "Grit": "grit",
}

_KEY_TO_LABEL = {
    "brawn": "Brawn",
    "brains": "Brains",
    "fight": "Fight",
    "flight": "Flight",
    "charm": "Charm",
    "grit": "Grit",
}


def normalize_stat_key(label_or_key: str) -> str:
    """Convierte etiqueta UI o variante a clave interna."""
    s = (label_or_key or "").strip()
    if not s:
        return "brains"
    k = _DISPLAY_TO_KEY.get(s)
    if k:
        return k
    low = s.lower()
    if low in _KEY_TO_LABEL:
        return low
    return "brains"


def stat_label_for_key(key: str) -> str:
    return _KEY_TO_LABEL.get(key, key.title())


@dataclass
class ExplosionStep:
    """Una subtirada de cadena de explosión (manual o derivada del motor)."""

    step_index: int
    roll_value: int
    tokens_used: int
    mod_value: int
    explodes: bool

    def to_json_dict(self) -> dict[str, Any]:
        return {
            "step_index": self.step_index,
            "roll_value": self.roll_value,
            "tokens_used": self.tokens_used,
            "mod_value": self.mod_value,
            "explodes": self.explodes,
        }

    @staticmethod
    def from_json_dict(d: dict[str, Any]) -> ExplosionStep:
        return ExplosionStep(
            step_index=int(d.get("step_index", 0)),
            roll_value=int(d.get("roll_value", 0)),
            tokens_used=int(d.get("tokens_used", 0)),
            mod_value=int(d.get("mod_value", 0)),
            explodes=bool(d.get("explodes", False)),
        )


@dataclass
class RollInput:
    """Entrada del usuario antes de persistir (opcional para tests / motor)."""

    player_id: Optional[int]
    check_value: str
    rolled_value: str
    main_tokens_used: int
    mod_value: int
    comment: str
    context: str
    stat_key: str
    stat_label: str
    star_active: bool
    explosions: list[ExplosionStep] = field(default_factory=list)


@dataclass
class RollRecord:
    """Registro persistible de una tirada (historial)."""

    player_id: Optional[int]
    player_name: str
    stat_key: str
    stat_label: str
    base_dice: str
    check_value: str
    rolled_value: str
    result_label: str
    main_tokens_used: int
    total_tokens_used: int
    mod_value: int
    star_active: bool
    comment: str
    context: str
    explosions: list[ExplosionStep] = field(default_factory=list)
    history_id: Optional[int] = None
    timestamp: Optional[datetime] = None
    raw_payload: dict[str, Any] = field(default_factory=dict)

    def explosion_count(self) -> int:
        return len(self.explosions)

    def to_raw_payload_json(self) -> str:
        base = dict(self.raw_payload)
        base.setdefault("explosions", [e.to_json_dict() for e in self.explosions])
        return json.dumps(base, ensure_ascii=False)

    @staticmethod
    def from_db_row(
        row: dict[str, Any],
        explosion_rows: Optional[list[dict[str, Any]]] = None,
    ) -> RollRecord:
        ts_raw = row.get("created_at") or row.get("timestamp")
        ts: Optional[datetime] = None
        if ts_raw:
            try:
                ts = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))
            except ValueError:
                ts = None
        raw = {}
        rj = row.get("raw_payload_json") or ""
        if rj:
            try:
                raw = json.loads(rj)
            except json.JSONDecodeError:
                raw = {}
        ex: list[ExplosionStep] = []
        if explosion_rows:
            for er in sorted(explosion_rows, key=lambda x: int(x.get("step_index", 0))):
                ex.append(
                    ExplosionStep(
                        step_index=int(er.get("step_index", 0)),
                        roll_value=int(er.get("roll_value") or 0),
                        tokens_used=int(er.get("tokens_used") or 0),
                        mod_value=int(er.get("mod_value") or 0),
                        explodes=bool(int(er.get("explodes") or 0)),
                    )
                )
        elif raw.get("explosions"):
            ex = [ExplosionStep.from_json_dict(x) for x in raw["explosions"]]

        return RollRecord(
            history_id=int(row["id"]) if row.get("id") is not None else None,
            timestamp=ts,
            player_id=int(row["player_id"]) if row.get("player_id") is not None else None,
            player_name=str(row.get("player_name") or ""),
            stat_key=str(row.get("stat_key") or "brains"),
            stat_label=str(row.get("stat_label") or stat_label_for_key(str(row.get("stat_key") or ""))),
            base_dice=str(row.get("base_dice") or ""),
            check_value=str(row.get("check_value") or ""),
            rolled_value=str(row.get("rolled_value") or ""),
            result_label=str(row.get("result_label") or ""),
            main_tokens_used=int(row.get("main_tokens_used") or 0),
            total_tokens_used=int(row.get("total_tokens_used") or 0),
            mod_value=int(row.get("mod_value") or 0),
            star_active=bool(int(row.get("star_active") or 0)),
            comment=str(row.get("comment") or ""),
            context=str(row.get("context") or ""),
            explosions=ex,
            raw_payload=raw,
        )

    def utc_timestamp(self) -> datetime:
        if self.timestamp:
            return self.timestamp if self.timestamp.tzinfo else self.timestamp.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc)
