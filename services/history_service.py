"""
Persistencia de tiradas en SQLite: roll_history + roll_explosions.
La lógica de resolución vive en core; aquí solo guardado y lectura.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from core.models import ExplosionStep, RollRecord

from database import get_connection


def save_roll(
    record: RollRecord,
    partida_id: int | None = None,
    mesa_id: int | None = None,
) -> int:
    """Inserta un registro completo y sus explosiones. Devuelve id del historial."""
    created = record.utc_timestamp().replace(microsecond=0).isoformat()
    with get_connection() as conn:
        cur = conn.execute(
            """
            INSERT INTO roll_history (
                created_at, player_id, player_name, stat_key, stat_label, base_dice,
                check_value, rolled_value, result_label,
                main_tokens_used, total_tokens_used, mod_value,
                star_active, comment, context, explosion_count, raw_payload_json, partida_id, mesa_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                created,
                record.player_id,
                record.player_name,
                record.stat_key,
                record.stat_label,
                record.base_dice,
                record.check_value,
                record.rolled_value,
                record.result_label,
                record.main_tokens_used,
                record.total_tokens_used,
                record.mod_value,
                1 if record.star_active else 0,
                record.comment,
                record.context,
                record.explosion_count(),
                record.to_raw_payload_json(),
                partida_id,
                mesa_id,
            ),
        )
        hid = int(cur.lastrowid)
        for step in record.explosions:
            conn.execute(
                """
                INSERT INTO roll_explosions (
                    roll_history_id, step_index, roll_value, tokens_used, mod_value, explodes
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    hid,
                    step.step_index,
                    step.roll_value,
                    step.tokens_used,
                    step.mod_value,
                    1 if step.explodes else 0,
                ),
            )
        conn.commit()
    return hid


def list_roll_history(limit: int = 500) -> list[RollRecord]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT * FROM roll_history
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        ids = [int(r["id"]) for r in rows]
        ex_map: dict[int, list] = {}
        if ids:
            qmarks = ",".join("?" * len(ids))
            ex_rows = conn.execute(
                f"SELECT * FROM roll_explosions WHERE roll_history_id IN ({qmarks}) ORDER BY roll_history_id, step_index",
                ids,
            ).fetchall()
            for er in ex_rows:
                hid = int(er["roll_history_id"])
                ex_map.setdefault(hid, []).append(dict(er))
        out: list[RollRecord] = []
        for r in rows:
            d = dict(r)
            hid = int(d["id"])
            out.append(RollRecord.from_db_row(d, ex_map.get(hid)))
        return out


def get_roll_by_id(history_id: int) -> Optional[RollRecord]:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM roll_history WHERE id = ?", (history_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        hid = int(d["id"])
        ex = conn.execute(
            "SELECT * FROM roll_explosions WHERE roll_history_id = ? ORDER BY step_index",
            (hid,),
        ).fetchall()
        return RollRecord.from_db_row(d, [dict(x) for x in ex])
