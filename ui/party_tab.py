"""
Personajes y mesa: CRUD en BD, cantidad de jugadores en pantalla y asignación por hueco.
"""
from PySide6.QtWidgets import (
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QListWidget,
    QListWidgetItem,
    QComboBox,
    QGroupBox,
    QMessageBox,
    QSizePolicy,
    QDialog,
    QFrame,
    QScrollArea,
)
from PySide6.QtCore import Signal, Qt

from core.paths import imagenes_dir
from database import (
    list_characters,
    save_character,
    delete_character,
    get_party_character_ids,
    set_party_character_ids,
)
from ui.character_editor_dialog import CharacterEditorDialog
from core.character_profile import CharacterProfile


class PartyTab(QWidget):
    """Emite señal cuando cambia la mesa para reconstruir la pestaña Tirada."""

    party_changed = Signal()

    def __init__(self, parent: QWidget | None = None):
        super().__init__(parent)
        self._slot_combos: list[QComboBox] = []
        self._player_count: int = 5
        self._id_to_profile: dict[int, CharacterProfile] = {}
        self._build_ui()
        self.refresh_roster()

    def _portrait_filenames(self) -> list[str]:
        d = imagenes_dir()
        if not d.is_dir():
            return []
        return [p.name for p in d.iterdir() if p.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp")]

    def _build_ui(self) -> None:
        root = QVBoxLayout(self)
        root.setContentsMargins(16, 16, 16, 16)
        root.setSpacing(14)

        hint = QLabel(
            "Define personajes (dados y TI/SI/MI como en el Excel). "
            "Elige cuántos jugadores ves en pantalla y qué personaje ocupa cada hueco."
        )
        hint.setWordWrap(True)
        hint.setStyleSheet("color: #aaa;")
        root.addWidget(hint)

        roster_box = QGroupBox("Personajes guardados")
        roster_outer = QVBoxLayout(roster_box)

        roster_split = QHBoxLayout()
        roster_split.setSpacing(12)

        left_col = QVBoxLayout()
        self._roster = QListWidget()
        self._roster.setMinimumHeight(180)
        self._roster.setMaximumWidth(280)
        self._roster.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Expanding)
        self._roster.currentItemChanged.connect(self._on_roster_selection_changed)
        left_col.addWidget(self._roster)

        btn_row = QHBoxLayout()
        self._btn_new = QPushButton("Nuevo")
        self._btn_edit = QPushButton("Editar")
        self._btn_del = QPushButton("Eliminar")
        btn_row.addWidget(self._btn_new)
        btn_row.addWidget(self._btn_edit)
        btn_row.addWidget(self._btn_del)
        left_col.addLayout(btn_row)
        roster_split.addLayout(left_col, 0)

        sep = QFrame()
        sep.setFrameShape(QFrame.Shape.VLine)
        sep.setStyleSheet("color: #4dd84d;")
        roster_split.addWidget(sep)

        self._detail = QLabel()
        self._detail.setWordWrap(True)
        self._detail.setTextFormat(Qt.TextFormat.RichText)
        self._detail.setAlignment(Qt.AlignmentFlag.AlignTop | Qt.AlignmentFlag.AlignLeft)
        self._detail.setMinimumWidth(320)
        self._detail.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.MinimumExpanding)
        self._detail.setStyleSheet("color: #e0e0e0; padding: 8px;")
        self._detail.setText(
            "<p style='color:#888'>Selecciona un personaje para ver sus dados y modificadores.</p>"
        )

        detail_scroll = QScrollArea()
        detail_scroll.setWidgetResizable(True)
        detail_scroll.setFrameShape(QFrame.Shape.NoFrame)
        detail_scroll.setMinimumHeight(200)
        detail_scroll.setWidget(self._detail)
        roster_split.addWidget(detail_scroll, 1)

        roster_outer.addLayout(roster_split)
        root.addWidget(roster_box)

        mesa = QGroupBox("Mesa (tirada)")
        mesa_l = QVBoxLayout(mesa)
        row1 = QHBoxLayout()
        row1.addWidget(QLabel("Jugadores en pantalla:"))
        self._btn_players_minus = QPushButton("−")
        self._btn_players_minus.setFixedWidth(36)
        self._btn_players_minus.setToolTip("Quitar un hueco")
        self._lbl_players = QLabel("5")
        self._lbl_players.setMinimumWidth(28)
        self._lbl_players.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._lbl_players.setStyleSheet("color: #66ff66; font-weight: bold; font-size: 14px;")
        self._btn_players_plus = QPushButton("+")
        self._btn_players_plus.setFixedWidth(36)
        self._btn_players_plus.setToolTip("Añadir un hueco")
        row1.addWidget(self._btn_players_minus)
        row1.addWidget(self._lbl_players)
        row1.addWidget(self._btn_players_plus)
        row1.addStretch()
        mesa_l.addLayout(row1)

        self._slots_container = QVBoxLayout()
        mesa_l.addLayout(self._slots_container)
        root.addWidget(mesa)

        apply_row = QHBoxLayout()
        self._btn_apply = QPushButton("Aplicar mesa a la tirada")
        self._btn_apply.setObjectName("globalBtn")
        self._btn_apply.clicked.connect(self._on_apply)
        apply_row.addStretch()
        apply_row.addWidget(self._btn_apply)
        apply_row.addStretch()
        root.addLayout(apply_row)

        root.addStretch()

        self._btn_new.clicked.connect(self._on_new)
        self._btn_edit.clicked.connect(self._on_edit)
        self._btn_del.clicked.connect(self._on_delete)
        self._btn_players_minus.clicked.connect(lambda: self._bump_players(-1))
        self._btn_players_plus.clicked.connect(lambda: self._bump_players(1))

    def _bump_players(self, delta: int) -> None:
        new_val = max(1, min(10, self._player_count + delta))
        if new_val == self._player_count:
            return
        self._player_count = new_val
        self._lbl_players.setText(str(self._player_count))
        self._rebuild_slot_combos()

    def _on_roster_selection_changed(self, current: QListWidgetItem | None, _previous) -> None:
        if not current:
            self._detail.setText(
                "<p style='color:#888'>Selecciona un personaje para ver sus dados y modificadores.</p>"
            )
            return
        cid = current.data(32)
        if cid is None:
            return
        p = self._id_to_profile.get(int(cid))
        if p:
            self._detail.setText(p.stats_detail_html())
        else:
            self._detail.setText("<p style='color:#888'>Personaje no encontrado.</p>")

    def refresh_roster(self) -> None:
        chars = list_characters()
        self._roster.blockSignals(True)
        self._roster.clear()
        self._id_to_profile = {p.id: p for p in chars}
        for p in chars:
            QListWidgetItem(f"{p.name}  (id {p.id})", self._roster).setData(32, p.id)
        self._roster.blockSignals(False)

        party = get_party_character_ids()
        n = len(party) if party else min(5, max(1, len(chars)))
        if not party and chars:
            party = [c.id for c in chars[:n]]

        self._player_count = max(1, min(10, n))
        self._lbl_players.setText(str(self._player_count))

        self._rebuild_slot_combos()
        for i, cid in enumerate(party):
            if i < len(self._slot_combos):
                self._set_combo_to_id(self._slot_combos[i], cid)

        if self._roster.count() > 0:
            self._roster.setCurrentRow(0)

    def _rebuild_slot_combos(self) -> None:
        prev: list[object] = []
        for cb in self._slot_combos:
            prev.append(cb.currentData())
        while self._slots_container.count():
            item = self._slots_container.takeAt(0)
            if item.widget():
                item.widget().deleteLater()
        self._slot_combos.clear()
        n = self._player_count
        chars = list_characters()
        party = get_party_character_ids()

        for i in range(n):
            row = QHBoxLayout()
            row.addWidget(QLabel(f"Hueco {i + 1}"))
            cb = QComboBox()
            cb.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
            cb.addItem("— Vacío —", None)
            for p in chars:
                cb.addItem(p.name, p.id)
            row.addWidget(cb, 1)
            w = QWidget()
            w.setLayout(row)
            self._slots_container.addWidget(w)
            self._slot_combos.append(cb)
            cid = None
            if i < len(prev) and prev[i] is not None:
                cid = prev[i]
            elif i < len(party):
                cid = party[i]
            if cid is not None:
                self._set_combo_to_id(cb, int(cid))

    def _set_combo_to_id(self, cb: QComboBox, cid: int) -> None:
        idx = cb.findData(cid)
        if idx >= 0:
            cb.setCurrentIndex(idx)
        else:
            cb.setCurrentIndex(0)

    def _selected_roster_id(self) -> int | None:
        item = self._roster.currentItem()
        if not item:
            return None
        return item.data(32)

    def _on_new(self) -> None:
        dlg = CharacterEditorDialog(self, profile=None, portrait_files=self._portrait_filenames())
        if dlg.exec() != QDialog.DialogCode.Accepted:
            return
        name, portrait, dice, mods = dlg.get_values()
        if not name:
            QMessageBox.warning(self, "Nombre", "El nombre no puede estar vacío.")
            return
        try:
            save_character(None, name, portrait, dice, mods)
        except Exception as e:
            QMessageBox.critical(self, "Error", str(e))
            return
        self.refresh_roster()
        self.party_changed.emit()

    def _on_edit(self) -> None:
        cid = self._selected_roster_id()
        if cid is None:
            return
        from database import get_character

        p = get_character(cid)
        if not p:
            return
        dlg = CharacterEditorDialog(self, profile=p, portrait_files=self._portrait_filenames())
        if dlg.exec() != QDialog.DialogCode.Accepted:
            return
        name, portrait, dice, mods = dlg.get_values()
        if not name:
            QMessageBox.warning(self, "Nombre", "El nombre no puede estar vacío.")
            return
        try:
            save_character(cid, name, portrait, dice, mods)
        except Exception as e:
            QMessageBox.critical(self, "Error", str(e))
            return
        self.refresh_roster()
        self._on_roster_selection_changed(self._roster.currentItem(), None)
        self.party_changed.emit()

    def _on_delete(self) -> None:
        cid = self._selected_roster_id()
        if cid is None:
            return
        if QMessageBox.question(self, "Eliminar", "¿Eliminar este personaje?") != QMessageBox.StandardButton.Yes:
            return
        delete_character(cid)
        self.refresh_roster()
        self.party_changed.emit()

    def _on_apply(self) -> None:
        ids: list[int] = []
        for cb in self._slot_combos:
            cid = cb.currentData()
            if cid is not None:
                ids.append(int(cid))
        set_party_character_ids(ids)
        self.party_changed.emit()
        QMessageBox.information(self, "Mesa", "Configuración aplicada. Revisa la pestaña Tirada.")
