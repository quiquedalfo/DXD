"""
SQLite: logs de tiradas + personajes + configuración de mesa.
"""
import json
import sqlite3
from datetime import datetime
from typing import Optional

from core.character_data import DICE_TABLE, MODIFIER_TABLE, STATS
from core.character_profile import CharacterProfile
from core.partida_runtime import ensure_player_entries, parse_runtime_json, serialize_runtime
from core.paths import db_path as app_db_path


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(app_db_path()))
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS roll_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                character_name TEXT NOT NULL,
                stat_name TEXT NOT NULL,
                dice_expr TEXT NOT NULL,
                result INTEGER NOT NULL,
                detail TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS characters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                portrait_filename TEXT NOT NULL DEFAULT '',
                dice_json TEXT NOT NULL,
                mods_json TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS roll_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                player_id INTEGER,
                player_name TEXT NOT NULL,
                stat_key TEXT NOT NULL,
                stat_label TEXT NOT NULL,
                base_dice TEXT NOT NULL,
                check_value TEXT,
                rolled_value TEXT,
                result_label TEXT,
                main_tokens_used INTEGER NOT NULL DEFAULT 0,
                total_tokens_used INTEGER NOT NULL DEFAULT 0,
                mod_value INTEGER NOT NULL DEFAULT 0,
                star_active INTEGER NOT NULL DEFAULT 0,
                comment TEXT,
                context TEXT,
                explosion_count INTEGER NOT NULL DEFAULT 0,
                raw_payload_json TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS roll_explosions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                roll_history_id INTEGER NOT NULL,
                step_index INTEGER NOT NULL,
                roll_value INTEGER,
                tokens_used INTEGER NOT NULL DEFAULT 0,
                mod_value INTEGER NOT NULL DEFAULT 0,
                explodes INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (roll_history_id) REFERENCES roll_history(id)
            )
            """
        )
        _migrate_v1_roleadas_partidas(conn)
        _migrate_v1_mesas(conn)
        conn.commit()
    seed_default_characters_if_empty()
    ensure_party_defaults()
    seed_demo_v1_if_empty()
    ensure_hxh_examen_101_mesa()


def _migrate_v1_roleadas_partidas(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS roleadas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            descripcion TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS roleada_personajes (
            roleada_id INTEGER NOT NULL REFERENCES roleadas(id) ON DELETE CASCADE,
            character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
            sort_order INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (roleada_id, character_id)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS partidas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            roleada_id INTEGER NOT NULL REFERENCES roleadas(id) ON DELETE CASCADE,
            nombre TEXT NOT NULL,
            created_at TEXT NOT NULL,
            runtime_json TEXT NOT NULL DEFAULT '{}'
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS partida_personajes (
            partida_id INTEGER NOT NULL REFERENCES partidas(id) ON DELETE CASCADE,
            character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
            sort_order INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (partida_id, character_id)
        )
        """
    )
    cols = [r[1] for r in conn.execute("PRAGMA table_info(roll_history)").fetchall()]
    if "partida_id" not in cols:
        conn.execute("ALTER TABLE roll_history ADD COLUMN partida_id INTEGER REFERENCES partidas(id)")


def _migrate_v1_mesas(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS mesas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS mesa_players (
            mesa_id INTEGER NOT NULL REFERENCES mesas(id) ON DELETE CASCADE,
            character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
            sort_order INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (mesa_id, character_id)
        )
        """
    )
    cols = [r[1] for r in conn.execute("PRAGMA table_info(roll_history)").fetchall()]
    if "mesa_id" not in cols:
        conn.execute("ALTER TABLE roll_history ADD COLUMN mesa_id INTEGER REFERENCES mesas(id)")


def seed_demo_v1_if_empty() -> None:
    """Una roleada Demo + partida con 3 personajes en mesa (solo si no hay roleadas)."""
    with get_connection() as conn:
        n = conn.execute("SELECT COUNT(*) AS c FROM roleadas").fetchone()["c"]
        if n > 0:
            return
        chars = list_characters()
        if not chars:
            return
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        cur = conn.execute(
            "INSERT INTO roleadas (nombre, descripcion, created_at) VALUES (?, ?, ?)",
            ("Demo local", "Progreso V1: abrí una partida desde el launcher.", now),
        )
        rid = int(cur.lastrowid)
        for i, ch in enumerate(chars):
            conn.execute(
                "INSERT INTO roleada_personajes (roleada_id, character_id, sort_order) VALUES (?, ?, ?)",
                (rid, ch.id, i),
            )
        ids_mesa = [c.id for c in chars[:3]]
        rt = ensure_player_entries(parse_runtime_json("{}"), ids_mesa)
        for i, cid in enumerate(ids_mesa):
            rt["players"][str(cid)]["fichas"] = i + 1
        raw = serialize_runtime(rt)
        curp = conn.execute(
            """
            INSERT INTO partidas (roleada_id, nombre, created_at, runtime_json)
            VALUES (?, ?, ?, ?)
            """,
            (rid, "Partida demo", now, raw),
        )
        pid = int(curp.lastrowid)
        for i, cid in enumerate(ids_mesa):
            conn.execute(
                "INSERT INTO partida_personajes (partida_id, character_id, sort_order) VALUES (?, ?, ?)",
                (pid, cid, i),
            )
        conn.commit()


def ensure_hxh_examen_101_mesa() -> None:
    """
    Asegura una mesa fija para pruebas UX:
    HXH EXAMEN 101 con Fish, Joaking, Tito, Lorenzo y Jung.
    """
    target_order = ["Fish", "Joaking", "Tito", "Lorenzo", "Jung"]
    with get_connection() as conn:
        from datetime import timezone

        now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        mesa = conn.execute(
            "SELECT id FROM mesas WHERE UPPER(nombre) = UPPER(?)",
            ("HXH EXAMEN 101",),
        ).fetchone()
        if mesa is None:
            cur = conn.execute(
                "INSERT INTO mesas (nombre, created_at) VALUES (?, ?)",
                ("HXH EXAMEN 101", now),
            )
            mesa_id = int(cur.lastrowid)
        else:
            mesa_id = int(mesa["id"])

        # Resolver ids por nombre y conservar orden solicitado.
        rows = conn.execute(
            "SELECT id, name FROM characters WHERE name IN (?, ?, ?, ?, ?)",
            tuple(target_order),
        ).fetchall()
        by_name = {str(r["name"]): int(r["id"]) for r in rows}
        ids: list[int] = [by_name[n] for n in target_order if n in by_name]
        if not ids:
            # Fallback defensivo si cambian nombres seed.
            ids = [int(r["id"]) for r in conn.execute(
                "SELECT id FROM characters ORDER BY sort_order ASC, id ASC LIMIT 5"
            ).fetchall()]

        conn.execute("DELETE FROM mesa_players WHERE mesa_id = ?", (mesa_id,))
        for i, cid in enumerate(ids):
            conn.execute(
                """
                INSERT INTO mesa_players (mesa_id, character_id, sort_order)
                VALUES (?, ?, ?)
                """,
                (mesa_id, cid, i),
            )
        conn.commit()


def ensure_party_defaults() -> None:
    """Si hay personajes pero no hay mesa guardada, usar los primeros hasta 5."""
    if get_setting("party_json", "").strip():
        return
    chars = list_characters()
    if not chars:
        return
    set_party_character_ids([c.id for c in chars[:5]])


def seed_default_characters_if_empty() -> None:
    with get_connection() as conn:
        n = conn.execute("SELECT COUNT(*) AS c FROM characters").fetchone()["c"]
        if n > 0:
            return
        order = 0
        for name in DICE_TABLE:
            dice = {s: DICE_TABLE[name].get(s, "D20") for s in STATS}
            mods_raw = MODIFIER_TABLE.get(name, {})
            mods = {s: mods_raw.get(s) for s in STATS}
            conn.execute(
                """
                INSERT INTO characters (name, portrait_filename, dice_json, mods_json, sort_order)
                VALUES (?, '', ?, ?, ?)
                """,
                (name, json.dumps(dice), json.dumps({s: (mods.get(s) or "") for s in STATS}), order),
            )
            order += 1
        ids = [r["id"] for r in conn.execute("SELECT id FROM characters ORDER BY sort_order, id").fetchall()]
        conn.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
            ("party_json", json.dumps({"character_ids": ids})),
        )
        conn.commit()


def get_setting(key: str, default: str = "") -> str:
    with get_connection() as conn:
        row = conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else default


def set_setting(key: str, value: str) -> None:
    with get_connection() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
            (key, value),
        )
        conn.commit()


def list_characters() -> list[CharacterProfile]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM characters ORDER BY sort_order ASC, id ASC"
        ).fetchall()
    return [CharacterProfile.from_db_row(dict(r)) for r in rows]


def get_character(cid: int) -> Optional[CharacterProfile]:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM characters WHERE id = ?", (cid,)).fetchone()
    return CharacterProfile.from_db_row(dict(row)) if row else None


def save_character(
    cid: Optional[int],
    name: str,
    portrait_filename: str,
    dice: dict[str, str],
    mods: dict[str, Optional[str]],
) -> int:
    dice_json = json.dumps({s: dice.get(s, "D20") for s in STATS})
    mods_json = json.dumps({s: (mods.get(s) or "") for s in STATS})
    with get_connection() as conn:
        if cid is None:
            cur = conn.execute(
                """
                INSERT INTO characters (name, portrait_filename, dice_json, mods_json, sort_order)
                VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM characters))
                """,
                (name.strip(), portrait_filename or "", dice_json, mods_json),
            )
            conn.commit()
            return int(cur.lastrowid)
        conn.execute(
            """
            UPDATE characters SET name = ?, portrait_filename = ?, dice_json = ?, mods_json = ?
            WHERE id = ?
            """,
            (name.strip(), portrait_filename or "", dice_json, mods_json, cid),
        )
        conn.commit()
        return cid


def delete_character(cid: int) -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM characters WHERE id = ?", (cid,))
        conn.commit()
    party = get_party_character_ids()
    party = [x for x in party if x != cid]
    set_party_character_ids(party)


def get_party_character_ids() -> list[int]:
    raw = get_setting("party_json", "")
    if not raw:
        return []
    try:
        data = json.loads(raw)
        ids = data.get("character_ids", [])
        return [int(x) for x in ids]
    except (json.JSONDecodeError, TypeError, ValueError):
        return []


def set_party_character_ids(ids: list[int]) -> None:
    set_setting("party_json", json.dumps({"character_ids": ids}))


def get_party_profiles() -> list[CharacterProfile]:
    ids = get_party_character_ids()
    out: list[CharacterProfile] = []
    for cid in ids:
        p = get_character(cid)
        if p:
            out.append(p)
    return out


def insert_log(
    character_name: str,
    stat_name: str,
    dice_expr: str,
    result: int,
    detail: Optional[str] = None,
) -> None:
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO roll_logs (created_at, character_name, stat_name, dice_expr, result, detail)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (datetime.utcnow().isoformat(), character_name, stat_name, dice_expr, result, detail or ""),
        )
        conn.commit()


def get_logs(limit: int = 500, partida_id: Optional[int] = None, mesa_id: Optional[int] = None) -> list[dict]:
    """Historial unificado: `roll_history` (nuevo) + `roll_logs` (legacy).
    Si `partida_id` está definido, solo entradas de esa partida en `roll_history`."""
    with get_connection() as conn:
        if partida_id is not None:
            new_rows = conn.execute(
                """
                SELECT id, created_at, player_name AS character_name, stat_label AS stat_name,
                       base_dice AS dice_expr, mod_value AS result,
                       COALESCE(result_label, '') || CASE WHEN comment != '' THEN ' | ' || comment ELSE '' END AS detail
                FROM roll_history
                WHERE partida_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (partida_id, limit),
            ).fetchall()
            return [dict(r) for r in new_rows]
        if mesa_id is not None:
            new_rows = conn.execute(
                """
                SELECT id, created_at, player_name AS character_name, stat_label AS stat_name,
                       base_dice AS dice_expr, mod_value AS result,
                       COALESCE(result_label, '') || CASE WHEN comment != '' THEN ' | ' || comment ELSE '' END AS detail
                FROM roll_history
                WHERE mesa_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (mesa_id, limit),
            ).fetchall()
            return [dict(r) for r in new_rows]
        new_rows = conn.execute(
            """
            SELECT id, created_at, player_name AS character_name, stat_label AS stat_name,
                   base_dice AS dice_expr, mod_value AS result,
                   COALESCE(result_label, '') || CASE WHEN comment != '' THEN ' | ' || comment ELSE '' END AS detail
            FROM roll_history
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        old_rows = conn.execute(
            """
            SELECT id, created_at, character_name, stat_name, dice_expr, result, detail
            FROM roll_logs
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    merged: list[dict] = [dict(r) for r in new_rows] + [dict(r) for r in old_rows]
    merged.sort(key=lambda x: str(x.get("created_at") or ""), reverse=True)
    return merged[:limit]
