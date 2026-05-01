"""
Main window: tab widget with Roll, Party setup, and Logs tabs.
"""
from collections.abc import Callable

from PySide6.QtWidgets import QHBoxLayout, QLabel, QMainWindow, QPushButton, QTabWidget, QWidget, QVBoxLayout

from ui.roll_tab import RollTab
from ui.logs_tab import LogsTab
from ui.party_tab import PartyTab


class MainWindow(QMainWindow):
    def __init__(
        self,
        partida_id: int | None = None,
        on_back: Callable[[], None] | None = None,
    ):
        super().__init__()
        self._partida_id = partida_id
        self._on_back = on_back

        if partida_id is not None:
            from services.partida_service import get_partida
            from services.roleada_service import get_roleada

            p = get_partida(partida_id)
            title = "DXD — RPG Tiradas"
            if p:
                rr = get_roleada(p.roleada_id)
                rn = rr.nombre if rr else "?"
                title = f"DXD — {rn} — {p.nombre}"
            self.setWindowTitle(title)
        else:
            self.setWindowTitle("DXD — RPG Tiradas")

        self.setMinimumSize(1080, 660)
        self.resize(1400, 760)

        central = QWidget()
        self.setCentralWidget(central)
        layout = QVBoxLayout(central)
        layout.setContentsMargins(12, 12, 12, 12)

        if on_back is not None:
            bar = QHBoxLayout()
            back = QPushButton("← Launcher")
            back.setToolTip("Volver a elegir roleada / partida")
            back.clicked.connect(on_back)
            bar.addWidget(back)
            if partida_id is not None:
                from services.partida_service import get_partida
                from services.roleada_service import get_roleada

                p = get_partida(partida_id)
                if p:
                    rr = get_roleada(p.roleada_id)
                    rn = rr.nombre if rr else ""
                    bar.addWidget(QLabel(f"<span style='color:#888'>{rn} · Partida activa: <b>{p.nombre}</b></span>"))
            bar.addStretch()
            layout.addLayout(bar)

        tabs = QTabWidget()
        self._roll_tab = RollTab(partida_id=partida_id)
        self._party_tab = PartyTab()
        self._logs_tab = LogsTab(partida_id=partida_id)
        tabs.addTab(self._roll_tab, "Tirada")
        tabs.addTab(self._party_tab, "Personajes y mesa")
        tabs.addTab(self._logs_tab, "Logs")
        layout.addWidget(tabs)

        self._roll_tab.roll_done.connect(self._logs_tab.refresh)
        self._party_tab.party_changed.connect(self._roll_tab.rebuild_panels)
