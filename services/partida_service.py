"""Partidas, roster de mesa y runtime JSON."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from core.partida_runtime import ensure_player_entries, parse_runtime_json, serialize_runtime

from database import get_character, get_connection
from core.character_profile import CharacterProfile


@dataclass
class PartidaRow:
    id: int
    roleada_id: int
    nombre: str
    created_at: str
    runtime_json: str


def list_partidas(roleada_id: int) -> list[PartidaRow]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, roleada_id, nombre, created_at, runtime_json
            FROM partidas WHERE roleada_id = ? ORDER BY id DESC
            """,
            (roleada_id,),
        ).fetchall()
    return [
        PartidaRow(
            int(r["id"]),
            int(r["roleada_id"]),
            str(r["nombre"]),
            str(r["created_at"]),
            str(r["runtime_json"] or "{}"),
        )
        for r in rows
    ]


def get_partida(pid: int) -> PartidaRow | None:
    with get_connection() as conn:
        r = conn.execute(
            "SELECT id, roleada_id, nombre, created_at, runtime_json FROM partidas WHERE id = ?",
            (pid,),
        ).fetchone()
    if not r:
        return None
    return PartidaRow(
        int(r["id"]),
        int(r["roleada_id"]),
        str(r["nombre"]),
        str(r["created_at"]),
        str(r["runtime_json"] or "{}"),
    )


def mesa_character_ids(partida_id: int) -> list[int]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT character_id FROM partida_personajes
            WHERE partida_id = ? ORDER BY sort_order ASC, character_id ASC
            """,
            (partida_id,),
        ).fetchall()
    return [int(r["character_id"]) for r in rows]


def create_partida(roleada_id: int, nombre: str, character_ids: list[int]) -> int:
    if not character_ids:
        raise ValueError("La partida necesita al menos un personaje en la mesa.")
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    runtime = ensure_player_entries(parse_runtime_json("{}"), character_ids)
    raw = serialize_runtime(runtime)
    with get_connection() as conn:
        cur = conn.execute(
            """
            INSERT INTO partidas (roleada_id, nombre, created_at, runtime_json)
            VALUES (?, ?, ?, ?)
            """,
            (roleada_id, nombre.strip(), now, raw),
        )
        pid = int(cur.lastrowid)
        for i, cid in enumerate(character_ids):
            conn.execute(
                """
                INSERT INTO partida_personajes (partida_id, character_id, sort_order)
                VALUES (?, ?, ?)
                """,
                (pid, cid, i),
            )
        conn.commit()
    return pid


def load_runtime(partida_id: int) -> dict:
    p = get_partida(partida_id)
    if not p:
        return parse_runtime_json("{}")
    return parse_runtime_json(p.runtime_json)


def save_runtime(partida_id: int, runtime: dict) -> None:
    raw = serialize_runtime(runtime)
    with get_connection() as conn:
        conn.execute("UPDATE partidas SET runtime_json = ? WHERE id = ?", (raw, partida_id))
        conn.commit()


def get_mesa_profiles_ordered(partida_id: int) -> list[tuple[CharacterProfile, dict]]:
    """Perfiles de personaje + dict runtime por id (para la mesa)."""
    ids = mesa_character_ids(partida_id)
    rt = load_runtime(partida_id)
    ensure_player_entries(rt, ids)
    out: list[tuple[CharacterProfile, dict]] = []
    for cid in ids:
        prof = get_character(cid)
        if not prof:
            continue
        st = rt.get("players", {}).get(str(cid), {})
        out.append((prof, st if isinstance(st, dict) else {}))
    return out
