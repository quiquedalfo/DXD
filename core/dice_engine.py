"""
Motor de dados y explosiones automáticas (sin Qt).
Expone la misma lógica que usa la UI para poder testearla aislada.
"""
from __future__ import annotations

from core.dice import die_max_sides, parse_dice, roll_dice, roll_explosion_chain

__all__ = [
    "die_max_sides",
    "parse_dice",
    "roll_dice",
    "roll_explosion_chain",
]
