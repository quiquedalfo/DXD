"""
Estado de sesión persistente (JSON): contexto global, contador secreto, stat global opcional.
La UI no debe ser la única fuente de verdad: este módulo centraliza lectura/escritura.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Optional

from core.paths import user_data_dir


def _state_path() -> Path:
    return user_data_dir() / "app_state.json"


@dataclass
class SessionState:
    global_context: str = ""
    secret_counter: int = 0
    selected_global_stat_key: Optional[str] = None
    extra: dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> str:
        d = asdict(self)
        return json.dumps(d, ensure_ascii=False, indent=2)

    @staticmethod
    def from_json(data: str) -> SessionState:
        if not data.strip():
            return SessionState()
        try:
            d = json.loads(data)
        except json.JSONDecodeError:
            return SessionState()
        return SessionState(
            global_context=str(d.get("global_context", "")),
            secret_counter=int(d.get("secret_counter", 0)),
            selected_global_stat_key=d.get("selected_global_stat_key"),
            extra=dict(d.get("extra") or {}),
        )


class StateManager:
    """Carga / guarda estado en disco bajo user_data_dir."""

    def __init__(self, path: Optional[Path] = None) -> None:
        self._path = path or _state_path()

    def load(self) -> SessionState:
        if not self._path.is_file():
            return SessionState()
        try:
            return SessionState.from_json(self._path.read_text(encoding="utf-8"))
        except OSError:
            return SessionState()

    def save(self, state: SessionState) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(state.to_json(), encoding="utf-8")
