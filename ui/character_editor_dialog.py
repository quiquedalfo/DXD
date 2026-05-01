"""
Diálogo para crear/editar un personaje (dados y modificadores TI/SI/MI por stat).
"""
from PySide6.QtWidgets import (
    QDialog,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QComboBox,
    QPushButton,
    QFormLayout,
    QDialogButtonBox,
    QWidget,
)

from core.character_data import DICE_SIDES, STATS
from core.character_profile import CharacterProfile


class CharacterEditorDialog(QDialog):
    def __init__(self, parent=None, profile: CharacterProfile | None = None, portrait_files: list[str] | None = None):
        super().__init__(parent)
        self._profile = profile
        self._portrait_files = portrait_files or []
        self.setWindowTitle("Editar personaje" if profile else "Nuevo personaje")
        self.setMinimumWidth(360)

        layout = QVBoxLayout(self)
        form = QFormLayout()

        self._name = QLineEdit()
        if profile:
            self._name.setText(profile.name)
        form.addRow("Nombre", self._name)

        self._portrait = QComboBox()
        self._portrait.addItem("(automático: Nombre.png)", "")
        for fn in sorted(self._portrait_files):
            self._portrait.addItem(fn, fn)
        if profile and profile.portrait_filename:
            idx = self._portrait.findData(profile.portrait_filename)
            if idx >= 0:
                self._portrait.setCurrentIndex(idx)
        form.addRow("Retrato", self._portrait)

        self._dice_combos: dict[str, QComboBox] = {}
        self._mod_combos: dict[str, QComboBox] = {}
        for stat in STATS:
            dc = QComboBox()
            for d in DICE_SIDES:
                dc.addItem(d, d)
            mc = QComboBox()
            for label, data in (("Ninguno", ""), ("TI (+1)", "TI"), ("SI (+3)", "SI"), ("MI (+5)", "MI")):
                mc.addItem(label, data)
            if profile:
                dv = profile.dice.get(stat, "D20")
                idx = dc.findData(dv)
                dc.setCurrentIndex(max(0, idx))
                mv = profile.mods.get(stat) or ""
                midx = mc.findData(mv)
                mc.setCurrentIndex(max(0, midx))
            self._dice_combos[stat] = dc
            self._mod_combos[stat] = mc
            form.addRow(stat, self._pair_row(dc, mc))

        layout.addLayout(form)

        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Save | QDialogButtonBox.StandardButton.Cancel
        )
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def _pair_row(self, a: QComboBox, b: QComboBox) -> QWidget:
        w = QWidget()
        h = QHBoxLayout(w)
        h.setContentsMargins(0, 0, 0, 0)
        h.addWidget(QLabel("Dado"))
        h.addWidget(a)
        h.addWidget(QLabel("Mod"))
        h.addWidget(b)
        return w

    def get_values(self) -> tuple[str, str, dict[str, str], dict[str, str | None]]:
        name = self._name.text().strip()
        portrait = self._portrait.currentData() or ""
        dice = {s: self._dice_combos[s].currentData() for s in STATS}
        mods: dict[str, str | None] = {}
        for s in STATS:
            v = self._mod_combos[s].currentData()
            mods[s] = v if v else None
        return name, portrait, dice, mods
