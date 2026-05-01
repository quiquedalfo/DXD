"""
Tab: list roll logs from SQLite with refresh.
"""
from PySide6.QtWidgets import (
    QWidget,
    QVBoxLayout,
    QTableWidget,
    QTableWidgetItem,
    QHeaderView,
    QPushButton,
    QAbstractItemView,
)
from PySide6.QtCore import Qt

from database import get_logs


class LogsTab(QWidget):
    def __init__(self, parent: QWidget | None = None, partida_id: int | None = None):
        super().__init__(parent)
        self._partida_id = partida_id
        self._build_ui()

    def _build_ui(self) -> None:
        layout = QVBoxLayout(self)
        self._table = QTableWidget()
        self._table.setColumnCount(6)
        self._table.setHorizontalHeaderLabels([
            "Fecha", "Personaje", "Stat", "Dados", "Resultado", "Detalle",
        ])
        self._table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.ResizeToContents)
        self._table.horizontalHeader().setStretchLastSection(True)
        self._table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self._table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        layout.addWidget(self._table)

        refresh_btn = QPushButton("Actualizar logs")
        refresh_btn.clicked.connect(self.refresh)
        layout.addWidget(refresh_btn)

        self.refresh()

    def refresh(self) -> None:
        rows = get_logs(partida_id=self._partida_id)
        self._table.setRowCount(len(rows))
        for i, row in enumerate(rows):
            created = row.get("created_at", "")[:19].replace("T", " ")
            self._table.setItem(i, 0, QTableWidgetItem(created))
            self._table.setItem(i, 1, QTableWidgetItem(row.get("character_name", "")))
            self._table.setItem(i, 2, QTableWidgetItem(row.get("stat_name", "")))
            self._table.setItem(i, 3, QTableWidgetItem(row.get("dice_expr", "")))
            self._table.setItem(i, 4, QTableWidgetItem(str(row.get("result", ""))))
            self._table.setItem(i, 5, QTableWidgetItem(row.get("detail", "")))
