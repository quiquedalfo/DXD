"""
Datos por personaje: dado y modificador (TI/SI/MI) por skill.
Según las tablas del Excel DXD.
"""
# TI = +1, SI = +3, MI = +5
MODIFIER_VALUES = {"TI": 1, "SI": 3, "MI": 5}

STATS = ("Brawn", "Brains", "Fight", "Flight", "Charm", "Grit")

DICE_SIDES = ("D4", "D6", "D8", "D10", "D12", "D20")

# Por personaje y stat: tipo de dado (D4, D6, D8, D10, D12, D20)
DICE_TABLE = {
    "Fish": {"Brawn": "D4", "Brains": "D20", "Fight": "D10", "Flight": "D8", "Charm": "D8", "Grit": "D12"},
    "Joaking": {"Brawn": "D4", "Brains": "D8", "Fight": "D6", "Flight": "D10", "Charm": "D20", "Grit": "D12"},
    "Tito": {"Brawn": "D12", "Brains": "D4", "Fight": "D10", "Flight": "D6", "Charm": "D10", "Grit": "D20"},
    "Lorenzo": {"Brawn": "D6", "Brains": "D12", "Fight": "D6", "Flight": "D8", "Charm": "D20", "Grit": "D10"},
    "Jung": {"Brawn": "D10", "Brains": "D8", "Fight": "D12", "Flight": "D6", "Charm": "D4", "Grit": "D20"},
}

# Por personaje y stat: TI, SI o MI (modificador de tabla)
MODIFIER_TABLE = {
    "Fish": {"Brawn": "TI", "Brains": "MI", "Fight": None, "Flight": None, "Charm": None, "Grit": None},
    "Joaking": {"Brawn": None, "Brains": "SI", "Fight": None, "Flight": None, "Charm": None, "Grit": None},
    "Tito": {"Brawn": "TI", "Brains": None, "Fight": "SI", "Flight": None, "Charm": "TI", "Grit": "MI"},
    "Lorenzo": {"Brawn": None, "Brains": "MI", "Fight": None, "Flight": "SI", "Charm": "TI", "Grit": None},
    "Jung": {"Brawn": None, "Brains": None, "Fight": None, "Flight": None, "Charm": None, "Grit": None},
}


def get_dice(character: str, stat: str) -> str:
    return DICE_TABLE.get(character, {}).get(stat, "D20")


def get_modifier_value(character: str, stat: str) -> int:
    ti_si_mi = MODIFIER_TABLE.get(character, {}).get(stat)
    if ti_si_mi is None:
        return 0
    return MODIFIER_VALUES.get(ti_si_mi, 0)
