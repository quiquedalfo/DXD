"""
Vista principal: log y guardar tirada arriba, luego cuadrícula de personajes.
"""

from PySide6.QtWidgets import (
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QGridLayout,
    QLabel,
    QPushButton,
    QFrame,
    QPlainTextEdit,
    QSizePolicy,
    QScrollArea,
    QMessageBox,
)
from PySide6.QtCore import Signal, Qt, QSize
from PySide6.QtGui import QIcon

from core.models import normalize_stat_key
from core.paths import resource_dir
from core.state_manager import StateManager
from database import get_party_profiles
from services.history_service import save_roll
from services.partida_service import get_mesa_profiles_ordered, load_runtime, save_runtime
from ui.character_panel import CharacterPanel
from core.character_profile import CharacterProfile

PANEL_MIN_WIDTH = 0


class _PlayersHostWidget(QWidget):
    """
    El QGridLayout suma los minimumWidth de cada columna y fuerza ancho total enorme.
    Forzamos ancho mínimo 0 en hint y en minimumSize para que el QScrollArea
    encoja el host al viewport (tarjetas se estrechan; sin sidescroll).
    """

    def minimumSizeHint(self) -> QSize:
        lay = self.layout()
        if lay is None:
            return QSize(0, 400)
        ms = lay.totalMinimumSize()
        return QSize(0, ms.height())

    def minimumSize(self) -> QSize:
        lay = self.layout()
        if lay is None:
            ms = super().minimumSize()
            return QSize(0, ms.height())
        ms = lay.totalMinimumSize()
        return QSize(0, ms.height())


def _grid_num_columns(num_players: int) -> int:
    """
    Prioriza una banda horizontal de jugadores: más columnas = menos filas.
    Hasta 5 en una fila; 6–10 en dos filas de como mucho 5 columnas.
    """
    if num_players <= 1:
        return 1
    if num_players <= 5:
        return num_players
    if num_players <= 10:
        return 5
    return 6


class RollTab(QWidget):
    roll_done = Signal()

    def __init__(
        self,
        parent: QWidget | None = None,
        partida_id: int | None = None,
        mesa_id: int | None = None,
        profiles_override: list[CharacterProfile] | None = None,
        checks_override: dict[int, int] | None = None,
    ):
        super().__init__(parent)
        self._panels: list[CharacterPanel] = []
        self._players_host: QWidget | None = None
        self._panels_layout: QGridLayout | None = None
        self._partida_id = partida_id
        self._mesa_id = mesa_id
        self._profiles_override = profiles_override
        self._checks_override = checks_override or {}
        self._state = StateManager().load()
        if self._partida_id is not None:
            rt0 = load_runtime(self._partida_id)
            gc = rt0.get("global_context")
            if gc is not None and str(gc).strip():
                self._state.global_context = str(gc).strip()
                StateManager().save(self._state)
        self._build_ui()
        self.rebuild_panels()

    def _build_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(10)

        top_bar = QHBoxLayout()
        top_bar.addStretch()
        guardar_btn = QPushButton("GUARDAR")
        guardar_btn.setObjectName("globalBtn")
        guardar_btn.setFixedHeight(36)
        guardar_btn.setToolTip("Guarda el estado de la partida (fichas, stats, contexto).")
        guardar_btn.clicked.connect(self._persist_partida_runtime)
        top_bar.addWidget(guardar_btn)
        layout.addLayout(top_bar)

        # Log + guardar tirada debajo de la barra GUARDAR, encima de las tarjetas de jugadores.
        global_panel = QFrame()
        global_panel.setObjectName("globalPanel")
        global_panel.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        global_outer = QHBoxLayout(global_panel)
        global_outer.setSpacing(14)
        global_outer.setContentsMargins(12, 12, 12, 12)

        log_col = QVBoxLayout()
        log_col.setSpacing(4)
        log_lbl = QLabel("Log")
        log_lbl.setStyleSheet("color: #66ff66;")
        log_col.addWidget(log_lbl)
        self._log_edit = QPlainTextEdit()
        self._log_edit.setObjectName("rollLog")
        self._log_edit.setLineWrapMode(QPlainTextEdit.LineWrapMode.WidgetWidth)
        self._log_edit.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self._log_edit.setPlaceholderText("Registro de tiradas y acciones...")
        self._log_edit.setMinimumHeight(120)
        self._log_edit.setMaximumHeight(200)
        self._log_edit.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        log_col.addWidget(self._log_edit, 1)
        global_outer.addLayout(log_col, 1)

        action_col = QVBoxLayout()
        action_col.setSpacing(8)
        action_col.setContentsMargins(0, 0, 0, 0)
        action_col.addStretch()
        self._commit_btn = QPushButton()
        self._commit_btn.setObjectName("commitRollBtn")
        self._commit_btn.setToolTip("Guardar tiradas, limpiar hoja y volver a quién tira")
        self._commit_btn.setFixedSize(120, 120)
        dice_icon_path = resource_dir() / "assets" / "icons" / "dice_neon.svg"
        if dice_icon_path.exists():
            self._commit_btn.setIcon(QIcon(str(dice_icon_path)))
            self._commit_btn.setIconSize(QSize(82, 82))
        else:
            self._commit_btn.setText("🎲")
            self._commit_btn.setStyleSheet("font-size: 42px;")
        action_col.addWidget(self._commit_btn, 0, Qt.AlignmentFlag.AlignCenter)
        commit_lbl = QLabel("GUARDAR TIRADA")
        commit_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        commit_lbl.setStyleSheet("color: #66ff66; font-weight: bold; font-size: 11px;")
        action_col.addWidget(commit_lbl)
        action_col.addStretch()
        global_outer.addLayout(action_col, 1)

        layout.addWidget(global_panel, 0)

        self._players_host = _PlayersHostWidget()
        self._players_host.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        self._panels_layout = QGridLayout(self._players_host)
        self._panels_layout.setHorizontalSpacing(10)
        self._panels_layout.setVerticalSpacing(10)
        self._panels_layout.setContentsMargins(4, 4, 4, 4)

        self._scroll = QScrollArea()
        self._scroll.setObjectName("playersScroll")
        self._scroll.setWidgetResizable(True)
        self._scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self._scroll.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        self._scroll.setFrameShape(QFrame.Shape.NoFrame)
        self._scroll.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        self._scroll.setMinimumHeight(260)
        self._scroll.setWidget(self._players_host)
        layout.addWidget(self._scroll, 1)

        self._commit_btn.clicked.connect(self._on_commit_rolls_and_back)

    def _mesa_rows(self) -> list[tuple]:
        """Lista de (perfil, runtime dict) si hay partida; si no, party legacy sin runtime."""
        if self._profiles_override is not None:
            return [(p, {}) for p in self._profiles_override]
        if self._partida_id is not None:
            return get_mesa_profiles_ordered(self._partida_id)
        return [(p, {}) for p in get_party_profiles()]

    def rebuild_panels(self) -> None:
        """Reconstruye los paneles en cuadrícula (3 cols hasta 6 jugadores, 4 cols si hay más)."""
        if not self._panels_layout:
            return
        self._panels.clear()
        while self._panels_layout.count():
            item = self._panels_layout.takeAt(0)
            w = item.widget()
            if w is not None:
                w.setParent(None)
                w.deleteLater()

        grid = self._panels_layout
        mesa = self._mesa_rows()
        if not mesa:
            empty = QLabel(
                "No hay jugadores en la mesa.\n"
                + (
                    "Creá una partida desde el launcher y elegí personajes."
                    if self._partida_id is not None
                    else "Ve a Personajes y mesa → Aplicar mesa a la tirada."
                )
            )
            empty.setStyleSheet("color: #888; padding: 24px;")
            empty.setWordWrap(True)
            empty.setAlignment(Qt.AlignmentFlag.AlignCenter)
            empty.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
            grid.addWidget(empty, 0, 0, 1, 6)
            return

        n = len(mesa)
        ncols = _grid_num_columns(n)
        nrows = (n + ncols - 1) // ncols
        for c in range(12):
            grid.setColumnStretch(c, 0)
        for r in range(12):
            grid.setRowStretch(r, 0)
        for c in range(ncols):
            grid.setColumnStretch(c, 1)
        for r in range(nrows):
            grid.setRowStretch(r, 1)

        for i, (prof, rt) in enumerate(mesa):
            row, col = i // ncols, i % ncols
            sk = (rt.get("selected_stat_key") if rt else None) or "brains"
            fichas = int(rt.get("fichas", 0)) if rt else 0
            panel = CharacterPanel(prof, initial_fichas=fichas, initial_stat_key=sk)
            ck = self._checks_override.get(prof.id)
            if ck is not None:
                panel.set_check_value(ck)
            panel.check_requested.connect(self._on_check)
            panel.setMinimumWidth(PANEL_MIN_WIDTH)
            panel.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
            self._panels.append(panel)
            grid.addWidget(panel, row, col)

    def _persist_partida_runtime(self) -> None:
        ctx = (self._state.global_context or "").strip()
        if self._profiles_override is not None:
            StateManager().save(self._state)
            return
        if self._partida_id is None:
            StateManager().save(self._state)
            return
        rt = load_runtime(self._partida_id)
        rt["global_context"] = ctx
        pl = rt.setdefault("players", {})
        for p in self._panels:
            cid = str(p.character_id())
            old = pl.get(cid, {}) if isinstance(pl.get(cid), dict) else {}
            pl[cid] = {
                "fichas": p.get_fichas_totales(),
                "selected_stat_key": normalize_stat_key(p.current_stat_label() or "Brains"),
                "star_active": p.is_key_moment(),
                "fail_count": int(old.get("fail_count", 0)),
            }
        save_runtime(self._partida_id, rt)
        StateManager().save(self._state)

    def _on_check(self, character_name: str, stat_name: str) -> None:
        panel = next((p for p in self._panels if p.character_name() == character_name), None)
        if panel:
            dice = panel.get_dice_type()
            total_mod = panel.get_total_roll_value()
            line = f"{character_name} — {stat_name} ({dice}, +MOD {total_mod})\n"
            self._log_edit.appendPlainText(line.strip())
            ctx = (self._state.global_context or "").strip()
            rec = panel.build_roll_record(context=ctx)
            save_roll(rec, partida_id=self._partida_id, mesa_id=self._mesa_id)
            panel.clear_star_after_roll()
            StateManager().save(self._state)
            self._sync_runtime_after_roll(panel)

    def _sync_runtime_after_roll(self, panel: CharacterPanel) -> None:
        if self._partida_id is None:
            return
        rt = load_runtime(self._partida_id)
        rt["global_context"] = (self._state.global_context or "").strip()
        pl = rt.setdefault("players", {})
        cid = str(panel.character_id())
        old = pl.get(cid, {}) if isinstance(pl.get(cid), dict) else {}
        pl[cid] = {
            "fichas": panel.get_fichas_totales(),
            "selected_stat_key": normalize_stat_key(panel.current_stat_label() or "Brains"),
            "star_active": False,
            "fail_count": int(old.get("fail_count", 0)),
        }
        save_runtime(self._partida_id, rt)

    def _on_commit_rolls_and_back(self) -> None:
        """Registra tiradas cargadas, limpia la hoja y vuelve al menú de quién tira."""
        saved = 0
        for panel in self._panels:
            if panel.has_pending_roll():
                panel.perform_check()
                saved += 1

        if saved == 0:
            QMessageBox.information(self, "Tirada", "No hay tiradas cargadas para guardar.")
            return

        for panel in self._panels:
            panel.clear_roll_entry()
        self._log_edit.clear()
        self._persist_partida_runtime()
        self.roll_done.emit()
