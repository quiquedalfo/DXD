"""
Estado runtime de una partida (serializado en partidas.runtime_json).
"""
from __future__ import annotations

import json
from typing import Any


RUNTIME_VERSION = 1


def default_runtime() -> dict[str, Any]:
    return {
        "version": RUNTIME_VERSION,
        "global_context": "",
        "secret_counter": 0,
        "players": {},
    }


def parse_runtime_json(raw: str | None) -> dict[str, Any]:
    if not raw or not raw.strip():
        return default_runtime()
    try:
        d = json.loads(raw)
    except json.JSONDecodeError:
        return default_runtime()
    if not isinstance(d, dict):
        return default_runtime()
    d.setdefault("version", RUNTIME_VERSION)
    d.setdefault("global_context", "")
    d.setdefault("secret_counter", 0)
    d.setdefault("players", {})
    return d


def ensure_player_entries(runtime: dict[str, Any], character_ids: list[int]) -> dict[str, Any]:
    players: dict[str, Any] = runtime.setdefault("players", {})
    for cid in character_ids:
        key = str(cid)
        if key not in players:
            players[key] = {
                "fichas": 0,
                "selected_stat_key": "brains",
                "star_active": False,
                "fail_count": 0,
            }
    return runtime


def serialize_runtime(runtime: dict[str, Any]) -> str:
    return json.dumps(runtime, ensure_ascii=False)
