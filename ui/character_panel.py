"""
Panel de un personaje: layout como Excel DXD.
Cabecera: columna izq (estrella, Dado, Mod tabla) | centro (retrato + nombre) | derecha (fichas + / −).
"""
import math
from PySide6.QtWidgets import (
    QFrame,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QLineEdit,
    QSpinBox,
    QSizePolicy,
    QWidget,
    QAbstractSpinBox,
    QPlainTextEdit,
)
from PySide6.QtCore import Qt, Signal, QPointF, QSize
from PySide6.QtGui import QFont, QPixmap, QIcon, QPainter, QColor

from core.character_data import STATS
from core.character_profile import CharacterProfile
from core.dice import die_max_sides
from core.models import ExplosionStep, RollRecord, normalize_stat_key, stat_label_for_key
from core.paths import imagenes_dir
from ui.stat_icons import get_stat_icon

STAT_LABELS = STATS

PORTRAIT_SIZE = 58
_HEADER_SIDE_W = 52  # ancho simétrico columnas izq/der del header
_HEADER_BOX_H = 24
_STAT_BTN = 26
# Fila de stats: altura total idéntica en las 4 celdas (CHECK, DADO, FICHAS, +MOD).
_DATA_ROW_FIXED_H = 62
_DATA_LABEL_H = 14
_DATA_VALUE_SLOT_H = 44


def _html_esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _name_font() -> QFont:
    f = QFont("Consolas", 11, QFont.Weight.Bold)
    if f.exactMatch():
        return f
    return QFont("Courier New", 11, QFont.Weight.Bold)


def _make_star_icon(size: int = 22, color: str = "#66ff66") -> QIcon:
    pix = QPixmap(size, size)
    pix.fill(Qt.GlobalColor.transparent)
    cx, cy = size / 2, size / 2
    R, r = size / 2 - 2, size / 4
    points = []
    for i in range(10):
        radius = R if i % 2 == 0 else r
        angle = math.radians(-90 + i * 36)
        points.append(QPointF(cx + radius * math.cos(angle), cy + radius * math.sin(angle)))
    painter = QPainter(pix)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing)
    painter.setPen(QColor(color))
    painter.setBrush(QColor(color))
    painter.drawPolygon(points)
    painter.end()
    return QIcon(pix)


class CharacterPanel(QFrame):
    check_requested = Signal(str, str)

    def __init__(
        self,
        profile: CharacterProfile,
        parent=None,
        *,
        initial_fichas: int | None = None,
        initial_stat_key: str | None = None,
    ):
        super().__init__(parent)
        self.setObjectName("characterPanel")
        self._profile = profile
        self._character_name = profile.name
        self._current_stat: str | None = None
        self._explosion_rolls: list[int] = []
        self._exo_steps: list[dict] = []
        self._last_deduct_fingerprint: str | None = None
        self._result_status_plain = "— · NO EXPLOTA"
        self._build_ui()
        if initial_fichas is not None:
            self._fichas_totales.setValue(max(0, min(999, int(initial_fichas))))
            self._apply_fichas_used_max()
        if initial_stat_key:
            self._select_stat_by_key(initial_stat_key)
        elif self._stat_btns:
            self._stat_btns[0].setChecked(True)
            self._current_stat = STAT_LABELS[0]
            self._update_dice_and_mod()

    def _select_stat_by_key(self, stat_key: str) -> None:
        label = stat_label_for_key(stat_key)
        found = False
        for btn in self._stat_btns:
            if btn.property("stat") == label:
                btn.setChecked(True)
                self._current_stat = label
                found = True
            else:
                btn.setChecked(False)
        if not found and self._stat_btns:
            self._stat_btns[0].setChecked(True)
            self._current_stat = STAT_LABELS[0]
        self._refresh_stat_icons()
        self._update_dice_and_mod()

    def character_id(self) -> int:
        return self._profile.id

    def current_stat_label(self) -> str | None:
        return self._current_stat

    def set_check_value(self, value: int | str) -> None:
        self._check_input.setText(str(value))
        self._update_check_and_explota()

    def _load_portrait(self) -> None:
        base = imagenes_dir()
        path = None
        if self._profile.portrait_filename:
            cand = base / self._profile.portrait_filename
            if cand.is_file():
                path = cand
        if path is None:
            cand = base / f"{self._character_name}.png"
            if cand.is_file():
                path = cand
        if path is not None:
            pix = QPixmap(str(path)).scaled(
                PORTRAIT_SIZE,
                PORTRAIT_SIZE,
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation,
            )
            self._portrait.setPixmap(pix)
        else:
            self._portrait.setText("👤")
            self._portrait.setStyleSheet(self._portrait.styleSheet() + " font-size: 28px;")

    def _bump_fichas_totales(self, delta: int) -> None:
        v = self._fichas_totales.value() + delta
        self._fichas_totales.setValue(max(0, min(999, v)))
        self._clear_fichas_selection()

    def _build_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setSpacing(3)
        layout.setContentsMargins(4, 4, 4, 4)

        # ----- Cabecera HUD: izq (estrella + dado/mod) | centro (retrato + nombre) | der (fichas + − +) -----
        self._star_btn = QPushButton()
        self._star_btn.setObjectName("starBtn")
        self._star_btn.setFixedSize(32, 32)
        self._star_btn.setCheckable(True)
        self._star_btn.setToolTip("Momento clave")
        self._star_btn.setIcon(_make_star_icon(20, "#66ff66"))
        self._star_btn.setIconSize(QSize(20, 20))

        self._dice_lbl = QLabel("D20")
        self._dice_lbl.setObjectName("headerDiceMain")
        self._dice_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)

        self._mod_lbl = QLabel("+0")
        self._mod_lbl.setObjectName("headerModSub")
        self._mod_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)

        left_inner = QVBoxLayout()
        left_inner.setSpacing(4)
        left_inner.setContentsMargins(6, 6, 6, 6)
        left_inner.addWidget(self._star_btn, 0, Qt.AlignmentFlag.AlignHCenter)
        left_inner.addWidget(self._dice_lbl)
        left_inner.addWidget(self._mod_lbl)
        left_box = QFrame()
        left_box.setObjectName("headerSideBox")
        left_box.setFixedWidth(_HEADER_SIDE_W)
        left_box.setLayout(left_inner)

        self._portrait = QLabel()
        self._portrait.setObjectName("portraitLabel")
        self._portrait.setFixedSize(PORTRAIT_SIZE, PORTRAIT_SIZE)
        self._portrait.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._portrait.setStyleSheet(
            "QLabel#portraitLabel { border: 1px solid #66ff66; border-radius: 0px; background: #050805; }"
        )
        self._load_portrait()

        name_bar = QFrame()
        name_bar.setObjectName("excelNameBar")
        name_l = QHBoxLayout(name_bar)
        name_l.setContentsMargins(6, 3, 6, 3)
        name_lbl = QLabel(self._character_name)
        name_lbl.setFont(_name_font())
        name_lbl.setObjectName("characterNameLbl")
        name_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        name_lbl.setWordWrap(True)
        name_l.addWidget(name_lbl)

        portrait_block = QFrame()
        portrait_block.setObjectName("portraitBlock")
        pb_l = QVBoxLayout(portrait_block)
        pb_l.setSpacing(4)
        pb_l.setContentsMargins(4, 4, 4, 4)
        pb_l.addWidget(self._portrait, 0, Qt.AlignmentFlag.AlignHCenter)
        pb_l.addWidget(name_bar)

        center_col = QVBoxLayout()
        center_col.setSpacing(0)
        center_col.setContentsMargins(0, 0, 0, 0)
        center_col.addWidget(portrait_block, 0, Qt.AlignmentFlag.AlignHCenter)
        center_w = QWidget()
        center_w.setLayout(center_col)

        self._fichas_totales = QSpinBox()
        self._fichas_totales.setObjectName("fichaTotalSpin")
        self._fichas_totales.setRange(0, 999)
        self._fichas_totales.setValue(0)
        self._fichas_totales.setButtonSymbols(QAbstractSpinBox.ButtonSymbols.NoButtons)
        self._fichas_totales.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._fichas_totales.setFixedSize(44, 24)
        self._fichas_totales.valueChanged.connect(self._on_fichas_totales_changed)

        btn_plus = QPushButton("+")
        btn_plus.setObjectName("fichaStepBtn")
        btn_plus.setFixedSize(22, 22)
        btn_plus.clicked.connect(lambda: self._bump_fichas_totales(1))
        btn_minus = QPushButton("−")
        btn_minus.setObjectName("fichaStepBtn")
        btn_minus.setFixedSize(22, 22)
        btn_minus.clicked.connect(lambda: self._bump_fichas_totales(-1))
        step_row = QHBoxLayout()
        step_row.setSpacing(4)
        step_row.setContentsMargins(0, 0, 0, 0)
        step_row.addStretch()
        step_row.addWidget(btn_minus)
        step_row.addWidget(btn_plus)
        step_row.addStretch()

        right_inner = QVBoxLayout()
        right_inner.setSpacing(4)
        right_inner.setContentsMargins(6, 6, 6, 6)
        right_inner.addWidget(self._fichas_totales, 0, Qt.AlignmentFlag.AlignHCenter)
        right_inner.addLayout(step_row)
        right_box = QFrame()
        right_box.setObjectName("headerSideBox")
        right_box.setFixedWidth(_HEADER_SIDE_W)
        right_box.setLayout(right_inner)

        header = QHBoxLayout()
        header.setSpacing(6)
        header.setContentsMargins(0, 0, 0, 0)
        header.addWidget(left_box, 0, Qt.AlignmentFlag.AlignTop)
        header.addStretch(1)
        header.addWidget(center_w, 0, Qt.AlignmentFlag.AlignTop)
        header.addStretch(1)
        header.addWidget(right_box, 0, Qt.AlignmentFlag.AlignTop)
        layout.addLayout(header)

        # ----- Barra de 6 iconos stats -----
        stat_frame = QFrame()
        stat_frame.setObjectName("excelStatBar")
        stats_row = QHBoxLayout(stat_frame)
        stats_row.setSpacing(4)
        stats_row.setContentsMargins(4, 4, 4, 4)
        self._stat_btns = []
        for s in STAT_LABELS:
            btn = QPushButton()
            btn.setObjectName("statBtn")
            btn.setCheckable(True)
            btn.setFixedSize(_STAT_BTN, _STAT_BTN)
            btn.setProperty("stat", s)
            btn.setToolTip(s)
            btn.clicked.connect(self._on_stat_clicked)
            self._stat_btns.append(btn)
            stats_row.addWidget(btn, 1)
        layout.addWidget(stat_frame)
        self._refresh_stat_icons()

        # ----- Grilla uniforme: CHECK, DADO TIRADO, FICHAS, +MOD -----
        self._check_input = QLineEdit()
        self._check_input.setPlaceholderText("10")
        self._check_input.setText("10")
        self._check_input.setObjectName("rollFieldCheck")
        self._check_input.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._check_input.setFixedHeight(24)

        self._dado_tirado = QLineEdit()
        self._dado_tirado.setPlaceholderText("—")
        self._dado_tirado.setObjectName("rollFieldDado")
        self._dado_tirado.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._dado_tirado.setFixedHeight(24)

        self._fichas = QSpinBox()
        self._fichas.setRange(0, 99)
        self._fichas.setButtonSymbols(QAbstractSpinBox.ButtonSymbols.NoButtons)
        self._fichas.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._fichas.setObjectName("rollFieldFichas")
        self._fichas.setFixedHeight(24)
        self._apply_fichas_used_max()

        self._mod_calc_lbl = QLabel("0")
        self._mod_calc_lbl.setObjectName("modTotalLbl")
        self._mod_calc_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._mod_calc_lbl.setFixedHeight(24)

        row5 = QHBoxLayout()
        row5.setSpacing(3)
        row5.setContentsMargins(0, 0, 0, 0)
        for lbl_text, w in (
            ("CHECK", self._check_input),
            ("DADO TIRADO", self._dado_tirado),
            ("FICHAS", self._fichas),
            ("+MOD", self._mod_calc_lbl),
        ):
            row5.addWidget(self._data_cell(lbl_text, w), 1)
        layout.addLayout(row5)

        self._comment_edit = QPlainTextEdit()
        self._comment_edit.setPlaceholderText("Comentario (opcional)")
        self._comment_edit.setObjectName("rollComment")
        self._comment_edit.setFixedHeight(68)
        self._comment_edit.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        layout.addWidget(self._comment_edit)

        self._check_input.textChanged.connect(self._on_roll_inputs_changed)
        self._dado_tirado.textChanged.connect(self._on_roll_inputs_changed)
        self._fichas.valueChanged.connect(self._on_roll_inputs_changed)

        # ----- Segmentos: 1ª banda explota + filas por explosión (como Excel) -----
        self._segments_container = QWidget()
        seg_outer = QVBoxLayout(self._segments_container)
        seg_outer.setContentsMargins(0, 0, 0, 0)
        seg_outer.setSpacing(4)

        explota_first = QFrame()
        explota_first.setObjectName("excelExplotaBar")
        explota_first.setMinimumHeight(38)
        explota_first.setMaximumHeight(48)
        explota_first_lay = QVBoxLayout(explota_first)
        explota_first_lay.setContentsMargins(4, 4, 4, 4)
        self._explota_lbl = QLabel()
        self._explota_lbl.setObjectName("excelExplotaText")
        self._explota_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._explota_lbl.setTextFormat(Qt.TextFormat.RichText)
        self._explota_lbl.setWordWrap(True)
        self._explota_lbl.setText(self._status_bar_html("—", "neutral", False))
        explota_first_lay.addWidget(self._explota_lbl)
        seg_outer.addWidget(explota_first)

        # Debajo del cartel: una o más filas (premio por explotar). Cada vez que dado+fichas = máximo, aparece otra fila.
        self._exo_steps_host = QWidget()
        self._exo_steps_host.setObjectName("exoStepsHost")
        self._exo_steps_layout = QVBoxLayout(self._exo_steps_host)
        self._exo_steps_layout.setContentsMargins(0, 0, 0, 0)
        self._exo_steps_layout.setSpacing(6)
        self._exo_steps_host.hide()
        seg_outer.addWidget(self._exo_steps_host)

        layout.addWidget(self._segments_container)

        self._apply_exo_fichas_max()

        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        self.setMinimumWidth(0)

    def _clear_fichas_selection(self) -> None:
        le = self._fichas_totales.findChild(QLineEdit)
        if le:
            le.deselect()

    def _on_fichas_totales_changed(self, _v: int = 0) -> None:
        self._clear_fichas_selection()
        self._apply_fichas_used_max()

    def _apply_fichas_used_max(self) -> None:
        cap = min(99, self._fichas_totales.value())
        self._fichas.blockSignals(True)
        self._fichas.setMaximum(cap)
        if self._fichas.value() > cap:
            self._fichas.setValue(cap)
        self._fichas.blockSignals(False)
        self._apply_exo_fichas_max()

    def _apply_exo_fichas_max(self) -> None:
        cap = min(99, self._fichas_totales.value())
        for s in self._exo_steps:
            sp = s["fichas"]
            sp.blockSignals(True)
            sp.setMaximum(cap)
            if sp.value() > cap:
                sp.setValue(cap)
            sp.blockSignals(False)

    def _read_exo_step(self, i: int) -> tuple[int, int]:
        if i < 0 or i >= len(self._exo_steps):
            return 0, 0
        d_edit = self._exo_steps[i]["dado"]
        try:
            dv = int((d_edit.text() or "0").strip())
        except ValueError:
            dv = 0
        return dv, self._exo_steps[i]["fichas"].value()

    def _append_exo_row(self) -> None:
        fr = QFrame()
        fr.setObjectName("explosionFollowStats")
        outer = QVBoxLayout(fr)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)
        h = QHBoxLayout()
        h.setSpacing(3)
        h.setContentsMargins(0, 0, 0, 0)
        d_in = QLineEdit()
        d_in.setPlaceholderText("—")
        d_in.setObjectName("rollFieldDado")
        d_in.setAlignment(Qt.AlignmentFlag.AlignCenter)
        d_in.setFixedHeight(24)
        f_sp = QSpinBox()
        f_sp.setRange(0, 99)
        f_sp.setButtonSymbols(QAbstractSpinBox.ButtonSymbols.NoButtons)
        f_sp.setAlignment(Qt.AlignmentFlag.AlignCenter)
        f_sp.setObjectName("rollFieldFichas")
        f_sp.setFixedHeight(24)
        m_lbl = QLabel("0")
        m_lbl.setObjectName("modTotalLbl")
        m_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        m_lbl.setFixedHeight(24)
        for lab, w in (
            ("DADO TIRADO", d_in),
            ("FICHAS", f_sp),
            ("+MOD", m_lbl),
        ):
            h.addWidget(self._cell(lab, w), 1)
        outer.addLayout(h)
        self._exo_steps_layout.addWidget(fr)
        step = {"frame": fr, "dado": d_in, "fichas": f_sp, "mod": m_lbl}
        self._exo_steps.append(step)
        d_in.textChanged.connect(self._on_exo_roll_changed)
        f_sp.valueChanged.connect(self._on_exo_roll_changed)

    def _pop_exo_row(self) -> None:
        if not self._exo_steps:
            return
        step = self._exo_steps.pop()
        fr = step["frame"]
        fr.setParent(None)
        fr.deleteLater()

    def _clear_all_exo_rows(self) -> None:
        while self._exo_steps:
            self._pop_exo_row()

    def _compute_target_exo_row_count(self) -> int:
        max_s = die_max_sides(self.get_dice_type())
        try:
            dm = int((self._dado_tirado.text() or "0").strip())
        except ValueError:
            dm = 0
        fm = self._fichas.value()
        if dm + fm != max_s:
            return 0
        target = 1
        i = 0
        while i < target:
            if i >= len(self._exo_steps):
                break
            d, f = self._read_exo_step(i)
            if d + f == max_s:
                target = i + 2
            i += 1
        return target

    def _sync_exo_rows(self) -> None:
        if self._explosion_rolls:
            return
        for _ in range(32):
            target = self._compute_target_exo_row_count()
            while len(self._exo_steps) > target:
                self._pop_exo_row()
            while len(self._exo_steps) < target:
                self._append_exo_row()
            t2 = self._compute_target_exo_row_count()
            if t2 == target:
                break
        self._apply_exo_fichas_max()
        self._update_exo_row_mod_labels()

    def _update_exo_row_mod_labels(self) -> None:
        mod_tabla = self.get_table_mod()
        try:
            dm = int((self._dado_tirado.text() or "0").strip())
        except ValueError:
            dm = 0
        fm = self._fichas.value()
        cum = mod_tabla + dm + fm
        for i, s in enumerate(self._exo_steps):
            d, f = self._read_exo_step(i)
            cum += d + f
            s["mod"].setText(str(cum))

    def _clear_explosion_state(self) -> None:
        self._explosion_rolls = []
        self._clear_all_exo_rows()
        self._update_check_and_explota()

    def _on_exo_roll_changed(self) -> None:
        self._last_deduct_fingerprint = None
        self._update_check_and_explota()

    def _on_roll_inputs_changed(self) -> None:
        """Cualquier cambio en la tirada invalida la cadena de explosión y permite un nuevo CHECK con descuento."""
        self._last_deduct_fingerprint = None
        self._clear_explosion_state()

    def _roll_fingerprint(self) -> str:
        return (
            f"{self._dado_tirado.text().strip()}|{self._fichas.value()}|"
            f"{self._check_input.text().strip()}|{self._current_stat}"
        )

    def _explosion_extra_total(self) -> int:
        """Suma de todas las filas de explosión manual (dado + fichas por fila)."""
        if self._explosion_rolls:
            return sum(self._explosion_rolls)
        t = 0
        for i in range(len(self._exo_steps)):
            d, f = self._read_exo_step(i)
            t += d + f
        return t

    def _compute_pasa_parts(self, total: int) -> tuple[str, str]:
        """Texto y tipo de color para PASA/NO PASA respecto al CHECK (mismo criterio que la barra principal)."""
        raw_check = self._check_input.text().strip()
        if not raw_check:
            return "—", "neutral"
        try:
            target = int(raw_check)
        except ValueError:
            return "—", "neutral"
        if total >= target:
            return f"PASA +{total - target}", "pass"
        return f"NO PASA -{target - total}", "fail"

    def _combined_status_markup(self, total: int, explota: bool) -> str:
        """Misma barra que arriba: PASA/NO PASA ± · EXPLOTA/NO EXPLOTA."""
        pasa_plain, pasa_kind = self._compute_pasa_parts(total)
        return self._status_bar_html(pasa_plain, pasa_kind, explota)

    def _data_cell(self, label_text: str, widget: QWidget) -> QFrame:
        """Celda de grilla: misma altura total y mismo slot de valor en las columnas de datos (CHECK/DADO/FICHAS/+MOD)."""
        box = QFrame()
        box.setObjectName("excelCell")
        box.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        box.setFixedHeight(_DATA_ROW_FIXED_H)
        col = QVBoxLayout(box)
        col.setSpacing(0)
        col.setContentsMargins(2, 2, 2, 2)
        lbl = QLabel(label_text)
        lbl.setObjectName("excelCellLabel")
        lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        lbl.setFixedHeight(_DATA_LABEL_H)
        lbl.setWordWrap(False)
        col.addWidget(lbl)
        inner = QWidget()
        inner.setFixedHeight(_DATA_VALUE_SLOT_H)
        inner_l = QVBoxLayout(inner)
        inner_l.setContentsMargins(0, 0, 0, 0)
        inner_l.setSpacing(0)
        inner_l.addStretch()
        inner_l.addWidget(widget, 0, Qt.AlignmentFlag.AlignCenter)
        inner_l.addStretch()
        col.addWidget(inner)
        return box

    def _cell(self, label_text: str, widget: QWidget) -> QFrame:
        """Celdas de explosión (misma estética que datos)."""
        return self._data_cell(label_text, widget)

    def _refresh_stat_icons(self) -> None:
        for btn in self._stat_btns:
            stat = btn.property("stat")
            if not stat:
                continue
            # Activo: fondo verde (stylesheet) + icono oscuro para contraste.
            color = "#0a0f0a" if btn.isChecked() else "#b8d4b8"
            btn.setIcon(get_stat_icon(stat, color=color, size=16))
            btn.setIconSize(QSize(16, 16))

    def _on_stat_clicked(self) -> None:
        for btn in self._stat_btns:
            if btn is self.sender():
                btn.setChecked(True)
                self._current_stat = btn.property("stat")
            else:
                btn.setChecked(False)
        self._refresh_stat_icons()
        self._explosion_rolls = []
        self._last_deduct_fingerprint = None
        self._clear_all_exo_rows()
        self._update_dice_and_mod()

    def _update_dice_and_mod(self) -> None:
        if not self._current_stat:
            return
        dice = self._profile.dice_for(self._current_stat)
        mod = self._profile.mod_for(self._current_stat)
        self._dice_lbl.setText(dice)
        self._mod_lbl.setText(f"+{mod}" if mod >= 0 else str(mod))
        self._update_check_and_explota()

    @staticmethod
    def _status_bar_html(pasa_plain: str, pasa_kind: str, explota: bool) -> str:
        """pasa_kind: neutral | pass | fail."""
        esc = _html_esc(pasa_plain)
        if pasa_kind == "pass":
            pasa_html = f'<span style="color:#66ff66">{esc}</span>'
        elif pasa_kind == "fail":
            pasa_html = f'<span style="color:#ff6666">{esc}</span>'
        else:
            pasa_html = f'<span style="color:#888888">{esc}</span>'
        exp_txt = "EXPLOTA" if explota else "NO EXPLOTA"
        exp_c = "#66ff66" if explota else "#888888"
        exp_html = f'<span style="color:{exp_c}">{exp_txt}</span>'
        return (
            f'<div style="text-align:center;font-size:10px;font-weight:bold">'
            f"{pasa_html}<span style=\"color:#4a604a\"> · </span>{exp_html}</div>"
        )

    def _update_check_and_explota(self) -> None:
        mod_tabla = self.get_table_mod()
        try:
            dado_val = int((self._dado_tirado.text() or "0").strip())
        except ValueError:
            dado_val = 0
        fichas_val = self._fichas.value()
        max_sides = die_max_sides(self.get_dice_type())

        if not self._explosion_rolls:
            self._sync_exo_rows()
        else:
            self._update_exo_row_mod_labels()

        main_expl = dado_val + fichas_val == max_sides
        exo_any_expl = False
        for i in range(len(self._exo_steps)):
            d, f = self._read_exo_step(i)
            if d + f == max_sides:
                exo_any_expl = True
        explota = bool(self._explosion_rolls) or main_expl or exo_any_expl

        extra = self._explosion_extra_total()
        total = mod_tabla + dado_val + fichas_val + extra
        self._mod_calc_lbl.setText(str(total))

        pasa_plain, pasa_kind = self._compute_pasa_parts(total)

        self._result_status_plain = f"{pasa_plain} · {'EXPLOTA' if explota else 'NO EXPLOTA'}"
        self._explota_lbl.setText(self._status_bar_html(pasa_plain, pasa_kind, explota))

        show_exo = len(self._exo_steps) > 0 and not self._explosion_rolls
        self._exo_steps_host.setVisible(show_exo)

    def _on_check(self) -> None:
        stat = self._current_stat or STAT_LABELS[0]
        fp = self._roll_fingerprint()
        if fp == self._last_deduct_fingerprint:
            self.check_requested.emit(self._character_name, stat)
            return
        try:
            dado_val = int((self._dado_tirado.text() or "0").strip())
        except ValueError:
            dado_val = 0
        fichas_used = self._fichas.value()
        if fichas_used > self._fichas_totales.value():
            self._apply_fichas_used_max()
            fichas_used = self._fichas.value()
        self._explosion_rolls = []
        self._fichas_totales.setValue(max(0, self._fichas_totales.value() - fichas_used))
        self._last_deduct_fingerprint = fp
        self._clear_all_exo_rows()
        self._update_check_and_explota()
        self.check_requested.emit(self._character_name, stat)

    def perform_check(self) -> None:
        """Ejecuta la misma lógica que antes disparaba el botón CHECK del panel."""
        self._on_check()

    def clear_roll_entry(self) -> None:
        """Limpia datos de la tirada actual, manteniendo configuración base del panel."""
        self._dado_tirado.clear()
        self._fichas.setValue(0)
        self._comment_edit.clear()
        self._last_deduct_fingerprint = None
        self._clear_explosion_state()

    def has_pending_roll(self) -> bool:
        """True si el panel tiene una tirada escrita para registrar."""
        return bool((self._dado_tirado.text() or "").strip())

    def set_check_result(self, value: int) -> None:
        """Rellena el dado tirado (p. ej. tras tirada automática)."""
        self._dado_tirado.setText(str(value))

    def get_dice_type(self) -> str:
        if not self._current_stat:
            return "D20"
        return self._profile.dice_for(self._current_stat)

    def get_table_mod(self) -> int:
        if not self._current_stat:
            return 0
        return self._profile.mod_for(self._current_stat)

    def is_key_moment(self) -> bool:
        return self._star_btn.isChecked()

    def get_fichas_totales(self) -> int:
        return self._fichas_totales.value()

    def get_total_roll_value(self) -> int:
        """+MOD mostrado: mod + tiro principal + explosión (manual o cadena automática)."""
        mod_tabla = self.get_table_mod()
        try:
            dado = int((self._dado_tirado.text() or "0").strip())
        except ValueError:
            dado = 0
        return mod_tabla + dado + self._fichas.value() + self._explosion_extra_total()

    def get_mod(self) -> int:
        return self.get_total_roll_value()

    def get_fichas(self) -> int:
        return self._fichas.value()

    def character_name(self) -> str:
        return self._character_name

    def clear_star_after_roll(self) -> None:
        """Lógica Excel: la estrella se apaga tras registrar la tirada si estaba activa."""
        self._star_btn.setChecked(False)

    def build_roll_record(self, *, context: str) -> RollRecord:
        """Arma el registro de historial según el estado actual del panel (tras CHECK)."""
        stat_label = self._current_stat or STAT_LABELS[0]
        sk = normalize_stat_key(stat_label)
        max_s = die_max_sides(self.get_dice_type())
        mod_tabla = self.get_table_mod()
        try:
            dm = int((self._dado_tirado.text() or "0").strip())
        except ValueError:
            dm = 0
        fm = self._fichas.value()
        cum = mod_tabla + dm + fm
        steps: list[ExplosionStep] = []
        for i in range(len(self._exo_steps)):
            d, f = self._read_exo_step(i)
            cum += d + f
            steps.append(
                ExplosionStep(
                    step_index=i,
                    roll_value=d,
                    tokens_used=f,
                    mod_value=cum,
                    explodes=bool(d + f == max_s),
                )
            )
        for i, r in enumerate(self._explosion_rolls):
            steps.append(
                ExplosionStep(
                    step_index=len(self._exo_steps) + i,
                    roll_value=r,
                    tokens_used=0,
                    mod_value=0,
                    explodes=bool(r == max_s),
                )
            )
        main_tok = self._fichas.value()
        total_tok = main_tok + sum(s.tokens_used for s in steps)
        try:
            mod_v = int((self._mod_calc_lbl.text() or "0").strip())
        except ValueError:
            mod_v = self.get_total_roll_value()
        result_text = (self._result_status_plain or "").strip() or "—"
        manual_payload = []
        for i in range(len(self._exo_steps)):
            d, f = self._read_exo_step(i)
            manual_payload.append({"dado": d, "fichas": f})
        return RollRecord(
            player_id=self._profile.id,
            player_name=self._character_name,
            stat_key=sk,
            stat_label=stat_label,
            base_dice=self.get_dice_type(),
            check_value=(self._check_input.text() or "").strip(),
            rolled_value=(self._dado_tirado.text() or "").strip(),
            result_label=result_text,
            main_tokens_used=main_tok,
            total_tokens_used=total_tok,
            mod_value=mod_v,
            star_active=self.is_key_moment(),
            comment=(self._comment_edit.toPlainText() or "").strip(),
            context=(context or "").strip(),
            explosions=steps,
            raw_payload={
                "manual_explosion_steps": manual_payload,
                "explosion_roll_values": list(self._explosion_rolls),
            },
        )
