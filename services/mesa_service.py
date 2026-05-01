"""Servicios V1 de mesas (crear, cargar, roster de jugadores)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from core.character_profile import CharacterProfile
from database import get_character, get_connection, list_characters


@dataclass
class MesaSummary:
    id: int
    nombre: str
    created_at: str
    players_count: int


def list_mesas() -> list[MesaSummary]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT m.id, m.nombre, m.created_at, COUNT(mp.character_id) AS players_count
            FROM mesas m
            LEFT JOIN mesa_players mp ON mp.mesa_id = m.id
            GROUP BY m.id, m.nombre, m.created_at
            ORDER BY m.id DESC
            """
        ).fetchall()
    return [
        MesaSummary(
            id=int(r["id"]),
            nombre=str(r["nombre"]),
            created_at=str(r["created_at"]),
            players_count=int(r["players_count"] or 0),
        )
        for r in rows
    ]


def create_mesa(nombre: str, character_ids: list[int]) -> int:
    name = nombre.strip()
    if not name:
        raise ValueError("El nombre de mesa no puede estar vacío.")
    if not character_ids:
        raise ValueError("La mesa debe tener al menos un jugador.")
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO mesas (nombre, created_at) VALUES (?, ?)",
            (name, now),
        )
        mid = int(cur.lastrowid)
        for i, cid in enumerate(character_ids):
            conn.execute(
                """
                INSERT INTO mesa_players (mesa_id, character_id, sort_order)
                VALUES (?, ?, ?)
                """,
                (mid, cid, i),
            )
        conn.commit()
    return mid


def get_mesa(mid: int) -> MesaSummary | None:
    with get_connection() as conn:
        r = conn.execute(
            """
            SELECT m.id, m.nombre, m.created_at, COUNT(mp.character_id) AS players_count
            FROM mesas m
            LEFT JOIN mesa_players mp ON mp.mesa_id = m.id
            WHERE m.id = ?
            GROUP BY m.id, m.nombre, m.created_at
            """,
            (mid,),
        ).fetchone()
    if not r:
        return None
    return MesaSummary(
        id=int(r["id"]),
        nombre=str(r["nombre"]),
        created_at=str(r["created_at"]),
        players_count=int(r["players_count"] or 0),
    )


def mesa_player_ids(mid: int) -> list[int]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT character_id
            FROM mesa_players
            WHERE mesa_id = ?
            ORDER BY sort_order ASC, character_id ASC
            """,
            (mid,),
        ).fetchall()
    return [int(r["character_id"]) for r in rows]


def mesa_profiles(mid: int) -> list[CharacterProfile]:
    out: list[CharacterProfile] = []
    for cid in mesa_player_ids(mid):
        p = get_character(cid)
        if p:
            out.append(p)
    return out


def all_character_options() -> list[CharacterProfile]:
    return list_characters()

