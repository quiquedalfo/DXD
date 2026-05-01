"""Flujo principal V1: Inicio -> Crear/Cargar Mesa -> Mesa -> Tirada -> volver a Mesa."""
from __future__ import annotations

from dataclasses import dataclass

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
    QMainWindow,
    QMessageBox,
    QPushButton,
    QFrame,
    QScrollArea,
    QStackedWidget,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
    QCheckBox,
    QHeaderView,
    QAbstractItemView,
)

from core.character_profile import CharacterProfile
from services.mesa_service import (
    all_character_options,
    create_mesa,
    get_mesa,
    list_mesas,
    mesa_profiles,
)
from ui.roll_tab import RollTab


class HomeScreen(QWidget):
    create_requested = Signal()
    load_requested = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(32, 32, 32, 32)
        lay.setSpacing(16)
        lay.addStretch()
        title = QLabel("<h2>DXD</h2><div style='color:#aaa'>Menú principal</div>")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        lay.addWidget(title)
        b1 = QPushButton("CREAR MESA")
        b1.setObjectName("globalBtn")
        b1.setMinimumHeight(56)
        b2 = QPushButton("CARGAR MESA")
        b2.setMinimumHeight(56)
        b1.clicked.connect(self.create_requested.emit)
        b2.clicked.connect(self.load_requested.emit)
        lay.addWidget(b1)
        lay.addWidget(b2)
        lay.addStretch()


class MesaCreateScreen(QWidget):
    back_requested = Signal()
    created = Signal(int)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._checks: list[tuple[int, QCheckBox]] = []
        lay = QVBoxLayout(self)
        lay.setContentsMargins(20, 20, 20, 20)
        lay.setSpacing(10)
        top = QHBoxLayout()
        back = QPushButton("← Volver")
        back.clicked.connect(self.back_requested.emit)
        top.addWidget(back)
        top.addWidget(QLabel("<b>Crear mesa</b>"))
        top.addStretch()
        lay.addLayout(top)
        form = QFormLayout()
        self._name = QLineEdit()
        self._name.setPlaceholderText("Nombre de la mesa")
        form.addRow("Nombre", self._name)
        lay.addLayout(form)
        lay.addWidget(QLabel("Jugadores de esta mesa"))
        sc = QScrollArea()
        sc.setWidgetResizable(True)
        host = QWidget()
        self._checks_lay = QVBoxLayout(host)
        sc.setWidget(host)
        lay.addWidget(sc, 1)
        actions = QHBoxLayout()
        save = QPushButton("Guardar mesa")
        save.setObjectName("globalBtn")
        save.clicked.connect(self._on_save)
        actions.addStretch()
        actions.addWidget(save)
        lay.addLayout(actions)
        self.reload_character_options()

    def reload_character_options(self) -> None:
        while self._checks_lay.count():
            it = self._checks_lay.takeAt(0)
            w = it.widget()
            if w:
                w.deleteLater()
        self._checks.clear()
        for i, p in enumerate(all_character_options()):
            cb = QCheckBox(p.name)
            cb.setChecked(i < min(3, len(all_character_options())))
            self._checks_lay.addWidget(cb)
            self._checks.append((p.id, cb))
        self._checks_lay.addStretch()

    def _on_save(self) -> None:
        name = self._name.text().strip()
        ids = [cid for cid, cb in self._checks if cb.isChecked()]
        try:
            mid = create_mesa(name, ids)
        except ValueError as e:
            QMessageBox.warning(self, "Crear mesa", str(e))
            return
        self.created.emit(mid)


class MesaLoadScreen(QWidget):
    back_requested = Signal()
    open_requested = Signal(int)

    def __init__(self, parent=None):
        super().__init__(parent)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(16, 16, 16, 16)
        lay.setSpacing(8)

        top = QHBoxLayout()
        back = QPushButton("← VOLVER")
        back.clicked.connect(self.back_requested.emit)
        top.addWidget(back, 0, Qt.AlignmentFlag.AlignLeft)
        top.addStretch()
        lay.addLayout(top)

        lay.addStretch(1)
        card_wrap = QHBoxLayout()
        card_wrap.addStretch(1)
        card = QFrame()
        card.setObjectName("menuCard")
        card.setMinimumWidth(420)
        card.setMaximumWidth(520)
        card_l = QVBoxLayout(card)
        card_l.setContentsMargins(14, 14, 14, 14)
        card_l.setSpacing(8)
        title = QLabel("CARGAR MESA")
        title.setObjectName("menuCardTitle")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        card_l.addWidget(title)
        sub = QLabel("Seleccioná una mesa guardada")
        sub.setObjectName("menuCardSub")
        sub.setAlignment(Qt.AlignmentFlag.AlignCenter)
        card_l.addWidget(sub)

        self._list = QListWidget()
        self._list.setObjectName("menuList")
        card_l.addWidget(self._list, 1)

        actions = QHBoxLayout()
        reload_btn = QPushButton("ACTUALIZAR")
        reload_btn.clicked.connect(self.reload_mesas)
        open_btn = QPushButton("ABRIR MESA")
        open_btn.setObjectName("globalBtn")
        open_btn.clicked.connect(self._open_selected)
        actions.addWidget(reload_btn)
        actions.addWidget(open_btn)
        card_l.addLayout(actions)
        card_wrap.addWidget(card)
        card_wrap.addStretch(1)
        lay.addLayout(card_wrap, 3)
        lay.addStretch(1)
        self.reload_mesas()

    def reload_mesas(self) -> None:
        self._list.clear()
        for m in list_mesas():
            label = f"{m.nombre}  ·  {m.players_count} jugadores"
            it = QListWidgetItem(label)
            it.setData(Qt.ItemDataRole.UserRole, m.id)
            self._list.addItem(it)
        if self._list.count() > 0:
            self._list.setCurrentRow(0)

    def _open_selected(self) -> None:
        it = self._list.currentItem()
        if not it:
            QMessageBox.information(self, "Cargar mesa", "No hay mesa seleccionada.")
            return
        self.open_requested.emit(int(it.data(Qt.ItemDataRole.UserRole)))


class MesaDetailScreen(QWidget):
    back_requested = Signal()
    continue_requested = Signal(int, object, object)  # mesa_id, selected ids, checks

    def __init__(self, parent=None):
        super().__init__(parent)
        self._mesa_id: int | None = None
        self._profiles: list[CharacterProfile] = []
        lay = QVBoxLayout(self)
        lay.setContentsMargins(20, 20, 20, 20)
        lay.setSpacing(10)
        top = QHBoxLayout()
        back = QPushButton("← Menú")
        back.clicked.connect(self.back_requested.emit)
        top.addWidget(back)
        self._title = QLabel("<b>Mesa</b>")
        top.addWidget(self._title)
        top.addStretch()
        lay.addLayout(top)

        self._table = QTableWidget()
        self._table.setColumnCount(5)
        self._table.setHorizontalHeaderLabels(["Tira", "Jugador", "Stats", "Dado base", "Check"])
        self._table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        self._table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.ResizeToContents)
        self._table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
        self._table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeMode.ResizeToContents)
        self._table.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeMode.ResizeToContents)
        self._table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self._table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        lay.addWidget(self._table, 1)

        actions = QHBoxLayout()
        cont = QPushButton("CONTINUAR")
        cont.setObjectName("globalBtn")
        cont.clicked.connect(self._on_continue)
        actions.addStretch()
        actions.addWidget(cont)
        lay.addLayout(actions)

    def load_mesa(self, mesa_id: int) -> None:
        self._mesa_id = mesa_id
        m = get_mesa(mesa_id)
        self._profiles = mesa_profiles(mesa_id)
        self._title.setText(f"<b>Mesa:</b> {m.nombre if m else f'#{mesa_id}'}")
        self._table.setRowCount(len(self._profiles))
        for i, p in enumerate(self._profiles):
            cb = QCheckBox()
            cb.setChecked(True)
            wrap = QWidget()
            l = QHBoxLayout(wrap)
            l.setContentsMargins(0, 0, 0, 0)
            l.setAlignment(Qt.AlignmentFlag.AlignCenter)
            l.addWidget(cb)
            self._table.setCellWidget(i, 0, wrap)
            self._table.setItem(i, 1, QTableWidgetItem(p.name))
            self._table.setItem(i, 2, QTableWidgetItem(", ".join(p.dice.keys())))
            self._table.setItem(i, 3, QTableWidgetItem(p.dice_for("Brains")))
            check = QLineEdit("10")
            check.setFixedWidth(56)
            self._table.setCellWidget(i, 4, check)
            self._table.item(i, 1).setData(Qt.ItemDataRole.UserRole, p.id)

    def _on_continue(self) -> None:
        if self._mesa_id is None:
            return
        selected_ids: list[int] = []
        checks: dict[int, int] = {}
        for i in range(self._table.rowCount()):
            id_item = self._table.item(i, 1)
            if not id_item:
                continue
            cid = int(id_item.data(Qt.ItemDataRole.UserRole))
            cb_wrap = self._table.cellWidget(i, 0)
            checked = False
            if cb_wrap and cb_wrap.layout() and cb_wrap.layout().count():
                w = cb_wrap.layout().itemAt(0).widget()
                if isinstance(w, QCheckBox):
                    checked = w.isChecked()
            if not checked:
                continue
            inp = self._table.cellWidget(i, 4)
            val = 10
            if isinstance(inp, QLineEdit):
                try:
                    val = int(inp.text().strip() or "10")
                except ValueError:
                    QMessageBox.warning(self, "Check", f"Check inválido para {id_item.text()}.")
                    return
            selected_ids.append(cid)
            checks[cid] = val
        if not selected_ids:
            QMessageBox.information(self, "Tirada", "Elegí al menos un jugador para tirar.")
            return
        self.continue_requested.emit(self._mesa_id, selected_ids, checks)


class RollScreen(QWidget):
    back_to_mesa = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._roll_tab: RollTab | None = None
        self._layout = QVBoxLayout(self)
        self._layout.setContentsMargins(10, 10, 10, 10)
        self._layout.setSpacing(8)
        top = QHBoxLayout()
        self._title = QLabel("<b>Tirada</b>")
        top.addWidget(self._title)
        top.addStretch()
        self._layout.addLayout(top)

    def mount_roll(self, mesa_id: int, profiles: list[CharacterProfile], checks: dict[int, int]) -> None:
        if self._roll_tab is not None:
            self._roll_tab.setParent(None)
            self._roll_tab.deleteLater()
        self._title.setText(f"<b>Tirada de mesa #{mesa_id}</b> · {len(profiles)} jugadores")
        self._roll_tab = RollTab(
            mesa_id=mesa_id,
            profiles_override=profiles,
            checks_override=checks,
        )
        self._roll_tab.roll_done.connect(self.back_to_mesa.emit)
        self._layout.addWidget(self._roll_tab, 1)


class MesaFlowWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("DXD — Flujo de mesas")
        self.setMinimumSize(1180, 740)
        self.resize(1440, 860)
        self._active_mesa_id: int | None = None

        self._stack = QStackedWidget()
        self.setCentralWidget(self._stack)

        self._home = HomeScreen()
        self._create = MesaCreateScreen()
        self._load = MesaLoadScreen()
        self._mesa_detail = MesaDetailScreen()
        self._roll = RollScreen()
        self._stack.addWidget(self._home)
        self._stack.addWidget(self._create)
        self._stack.addWidget(self._load)
        self._stack.addWidget(self._mesa_detail)
        self._stack.addWidget(self._roll)

        self._home.create_requested.connect(lambda: self._stack.setCurrentWidget(self._create))
        self._home.load_requested.connect(lambda: self._stack.setCurrentWidget(self._load))
        self._create.back_requested.connect(lambda: self._stack.setCurrentWidget(self._home))
        self._load.back_requested.connect(lambda: self._stack.setCurrentWidget(self._home))
        self._create.created.connect(self._open_mesa)
        self._load.open_requested.connect(self._open_mesa)
        self._mesa_detail.back_requested.connect(lambda: self._stack.setCurrentWidget(self._home))
        self._mesa_detail.continue_requested.connect(self._start_roll)
        self._roll.back_to_mesa.connect(self._back_to_mesa)

    def _open_mesa(self, mesa_id: int) -> None:
        self._active_mesa_id = mesa_id
        self._mesa_detail.load_mesa(mesa_id)
        self._stack.setCurrentWidget(self._mesa_detail)

    def _start_roll(self, mesa_id: int, selected_ids: list[int], checks: dict[int, int]) -> None:
        profiles = [p for p in mesa_profiles(mesa_id) if p.id in set(selected_ids)]
        self._roll.mount_roll(mesa_id=mesa_id, profiles=profiles, checks=checks)
        self._stack.setCurrentWidget(self._roll)

    def _back_to_mesa(self) -> None:
        if self._active_mesa_id is not None:
            self._mesa_detail.load_mesa(self._active_mesa_id)
        self._stack.setCurrentWidget(self._mesa_detail)

