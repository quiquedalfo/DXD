"""
Dice rolling logic for RPG (e.g. 1d20, 2d6+3).
"""
import re
import random
from typing import Tuple


def parse_dice(expr: str) -> Tuple[int, int, int]:
    """
    Parse expressions like '1d20', '2d6+3', 'd20'.
    Returns (num_dice, sides, modifier).
    """
    expr = expr.strip().lower().replace(" ", "")
    # d20, 1d20, 2d6+3, 1d8-1
    m = re.match(r"^(\d*)d(\d+)([+-]\d+)?$", expr)
    if not m:
        return (1, 20, 0)  # default 1d20
    num = int(m.group(1) or 1)
    sides = int(m.group(2))
    mod = int(m.group(3) or 0)
    return (num, sides, mod)


def roll_explosion_chain(max_sides: int, dado: int, fichas: int) -> list[int]:
    """
    Si dado + fichas == max_sides (sin contar el modificador de tabla), explota:
    se vuelve a tirar 1d(max_sides) y se repite mientras salga el máximo.
    Las fichas de la tirada principal cuentan para llegar al máximo; el mod de stat no.
    Devuelve la lista de tiradas extra.
    """
    if max_sides < 1:
        return []
    if dado + fichas != max_sides:
        return []
    rolls: list[int] = []
    while True:
        r = random.randint(1, max_sides)
        rolls.append(r)
        if r < max_sides:
            break
    return rolls


def die_max_sides(dice_str: str) -> int:
    """Dado tipo 'D4', 'D10' etc. Devuelve el número de caras (4, 10, ...)."""
    s = (dice_str or "").strip().upper()
    if s.startswith("D"):
        try:
            return int(s[1:])
        except ValueError:
            pass
    return 20


def roll_dice(expr: str) -> Tuple[int, str]:
    """
    Roll dice from expression (e.g. '1d20', '2d6+3').
    Returns (total_result, detail_string).
    """
    num, sides, mod = parse_dice(expr)
    if num < 1 or sides < 1:
        return (0, "Invalid dice")
    rolls = [random.randint(1, sides) for _ in range(num)]
    total = sum(rolls) + mod
    detail = f"{rolls}"
    if mod != 0:
        detail += f" {mod:+d}"
    detail += f" = {total}"
    return (total, detail)
