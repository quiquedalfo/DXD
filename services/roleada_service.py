"""CRUD mínimo de roleadas y pool de personajes."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from database import get_connection, list_characters


@dataclass
class RoleadaRow:
    id: int
    nombre: str
    descripcion: str
    created_at: str


def list_roleadas() -> list[RoleadaRow]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, nombre, descripcion, created_at FROM roleadas ORDER BY id ASC"
        ).fetchall()
    return [RoleadaRow(int(r["id"]), str(r["nombre"]), str(r["descripcion"] or ""), str(r["created_at"])) for r in rows]


def get_roleada(rid: int) -> RoleadaRow | None:
    with get_connection() as conn:
        r = conn.execute("SELECT id, nombre, descripcion, created_at FROM roleadas WHERE id = ?", (rid,)).fetchone()
    if not r:
        return None
    return RoleadaRow(int(r["id"]), str(r["nombre"]), str(r["descripcion"] or ""), str(r["created_at"]))


def create_roleada(nombre: str, descripcion: str = "") -> int:
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO roleadas (nombre, descripcion, created_at) VALUES (?, ?, ?)",
            (nombre.strip(), descripcion.strip(), now),
        )
        rid = int(cur.lastrowid)
        # Pool por defecto: todos los personajes globales
        for i, ch in enumerate(list_characters()):
            conn.execute(
                """
                INSERT OR IGNORE INTO roleada_personajes (roleada_id, character_id, sort_order)
                VALUES (?, ?, ?)
                """,
                (rid, ch.id, i),
            )
        conn.commit()
    return rid


def pool_character_ids(roleada_id: int) -> list[int]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT character_id FROM roleada_personajes
            WHERE roleada_id = ? ORDER BY sort_order ASC, character_id ASC
            """,
            (roleada_id,),
        ).fetchall()
    return [int(r["character_id"]) for r in rows]
