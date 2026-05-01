"""
Launcher V1: elegir roleada → partida → abrir mesa.
"""
from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMessageBox,
    QPushButton,
    QScrollArea,
    QVBoxLayout,
    QWidget,
    QCheckBox,
)

from services.partida_service import create_partida, list_partidas
from services.roleada_service import create_roleada, get_roleada, list_roleadas, pool_character_ids


class LauncherWindow(QWidget):
    """Ventana inicial: lista roleadas, partidas, acciones."""

    open_mesa = Signal(int)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("DXD — Roleadas y partidas")
        self.setMinimumSize(520, 480)
        self._build_ui()
        self._reload_roleadas()

    def _build_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(12)

        head = QLabel(
            "<b>Progreso V1</b><br/>"
            "<span style='color:#aaa'>Elegí una roleada, una partida, y abrí la mesa de tiradas. "
            "Si la BD está vacía de roleadas, se crea una <b>Demo local</b> al iniciar.</span>"
        )
        head.setWordWrap(True)
        layout.addWidget(head)

        row = QHBoxLayout()
        row.setSpacing(16)

        left = QVBoxLayout()
        left.addWidget(QLabel("<b>Roleadas</b>"))
        self._roleadas_list = QListWidget()
        self._roleadas_list.currentItemChanged.connect(self._on_roleada_changed)
        left.addWidget(self._roleadas_list)
        btn_new_r = QPushButton("Nueva roleada")
        btn_new_r.clicked.connect(self._new_roleada)
        left.addWidget(btn_new_r)
        row.addLayout(left, 1)

        right = QVBoxLayout()
        right.addWidget(QLabel("<b>Partidas</b>"))
        self._partidas_list = QListWidget()
        right.addWidget(self._partidas_list)
        row_btn = QHBoxLayout()
        btn_new_p = QPushButton("Nueva partida")
        btn_new_p.clicked.connect(self._new_partida)
        btn_open = QPushButton("Abrir mesa")
        btn_open.setObjectName("globalBtn")
        btn_open.clicked.connect(self._open_mesa)
        row_btn.addWidget(btn_new_p)
        row_btn.addWidget(btn_open)
        right.addLayout(row_btn)
        row.addLayout(right, 1)

        layout.addLayout(row)

    def _current_roleada_id(self) -> int | None:
        item = self._roleadas_list.currentItem()
        if not item:
            return None
        v = item.data(Qt.ItemDataRole.UserRole)
        return int(v) if v is not None else None

    def _reload_roleadas(self) -> None:
        self._roleadas_list.clear()
        for r in list_roleadas():
            it = QListWidgetItem(r.nombre)
            it.setData(Qt.ItemDataRole.UserRole, r.id)
            self._roleadas_list.addItem(it)
        if self._roleadas_list.count() > 0:
            self._roleadas_list.setCurrentRow(0)

    def _on_roleada_changed(self) -> None:
        self._partidas_list.clear()
        rid = self._current_roleada_id()
        if not rid:
            return
        for p in list_partidas(rid):
            it = QListWidgetItem(p.nombre)
            it.setData(Qt.ItemDataRole.UserRole, p.id)
            self._partidas_list.addItem(it)
        if self._partidas_list.count() > 0:
            self._partidas_list.setCurrentRow(0)

    def _new_roleada(self) -> None:
        d = QDialog(self)
        d.setWindowTitle("Nueva roleada")
        form = QFormLayout(d)
        name = QLineEdit()
        desc = QLineEdit()
        form.addRow("Nombre", name)
        form.addRow("Descripción", desc)
        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        form.addRow(buttons)
        buttons.accepted.connect(d.accept)
        buttons.rejected.connect(d.reject)
        if d.exec() != QDialog.DialogCode.Accepted:
            return
        n = name.text().strip()
        if not n:
            QMessageBox.warning(self, "Roleada", "El nombre no puede estar vacío.")
            return
        create_roleada(n, desc.text().strip())
        self._reload_roleadas()

    def _new_partida(self) -> None:
        rid = self._current_roleada_id()
        if not rid:
            QMessageBox.information(self, "Partida", "Seleccioná una roleada primero.")
            return
        pool = pool_character_ids(rid)
        if not pool:
            QMessageBox.warning(self, "Partida", "La roleada no tiene personajes en el pool.")
            return
        d = QDialog(self)
        d.setWindowTitle("Nueva partida")
        d.setMinimumWidth(400)
        v = QVBoxLayout(d)
        v.addWidget(QLabel("Nombre de la partida"))
        name_edit = QLineEdit()
        name_edit.setPlaceholderText("Ej. Sesión 3")
        v.addWidget(name_edit)
        v.addWidget(QLabel("Personajes en la mesa (subconjunto del pool de la roleada):"))
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        host = QWidget()
        checks_lay = QVBoxLayout(host)
        checks: list[tuple[int, QCheckBox]] = []
        for i, cid in enumerate(pool):
            cb = QCheckBox(f"ID {cid}")
            cb.setChecked(i < min(3, len(pool)))
            checks.append((cid, cb))
            checks_lay.addWidget(cb)
        from database import get_character

        for cid, cb in checks:
            ch = get_character(cid)
            cb.setText(ch.name if ch else f"#{cid}")
        scroll.setWidget(host)
        v.addWidget(scroll)
        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        v.addWidget(buttons)
        buttons.accepted.connect(d.accept)
        buttons.rejected.connect(d.reject)
        if d.exec() != QDialog.DialogCode.Accepted:
            return
        nombre = name_edit.text().strip() or "Sin nombre"
        selected = [cid for cid, cb in checks if cb.isChecked()]
        if not selected:
            QMessageBox.warning(self, "Partida", "Elegí al menos un personaje en la mesa.")
            return
        pid = create_partida(rid, nombre, selected)
        self._on_roleada_changed()
        for i in range(self._partidas_list.count()):
            it = self._partidas_list.item(i)
            if it and it.data(Qt.ItemDataRole.UserRole) == pid:
                self._partidas_list.setCurrentRow(i)
                break
        QMessageBox.information(self, "Partida", f"Partida creada (id {pid}). Podés abrir la mesa.")

    def _open_mesa(self) -> None:
        it = self._partidas_list.currentItem()
        if not it:
            QMessageBox.information(self, "Mesa", "Seleccioná una partida o creá una nueva.")
            return
        pid = int(it.data(Qt.ItemDataRole.UserRole))
        self.open_mesa.emit(pid)
