"""
Tema visual: fondo oscuro, acentos verde neón (réplica del Excel DXD).
"""
NEON_GREEN = "#66ff66"
DARK_BG = "#0d120d"
PANEL_BG = "#151a14"
INPUT_BG = "#1a2018"
BORDER_GREEN = "#4dd84d"

MAIN_STYLESHEET = f"""
    QMainWindow, QWidget {{
        background-color: {DARK_BG};
    }}
    QTabWidget::pane {{
        border: 1px solid {BORDER_GREEN};
        background-color: {PANEL_BG};
        border-radius: 4px;
        top: -1px;
    }}
    QTabBar::tab {{
        background-color: {PANEL_BG};
        color: {NEON_GREEN};
        border: 1px solid {BORDER_GREEN};
        padding: 6px 14px;
        margin-right: 2px;
    }}
    QTabBar::tab:selected {{
        background-color: {DARK_BG};
        border-bottom-color: {DARK_BG};
    }}
    QGroupBox {{
        color: {NEON_GREEN};
        border: 1px solid {BORDER_GREEN};
        border-radius: 4px;
        margin-top: 8px;
        font-weight: bold;
    }}
    QGroupBox::title {{
        subcontrol-origin: margin;
        left: 8px;
        padding: 0 4px;
    }}
    QLabel {{
        color: #e0e0e0;
    }}
    QLineEdit, QSpinBox, QPlainTextEdit, QTextEdit {{
        background-color: {INPUT_BG};
        color: {NEON_GREEN};
        border: 1px solid {BORDER_GREEN};
        border-radius: 3px;
        padding: 4px;
        selection-background-color: {BORDER_GREEN};
    }}
    QPushButton {{
        background-color: {PANEL_BG};
        color: {NEON_GREEN};
        border: 1px solid {BORDER_GREEN};
        border-radius: 4px;
        padding: 6px 12px;
        min-height: 20px;
    }}
    QPushButton:hover {{
        background-color: #1e2a1e;
    }}
    QPushButton:pressed {{
        background-color: {BORDER_GREEN};
        color: {DARK_BG};
    }}
    QPushButton#globalBtn {{
        background-color: {NEON_GREEN};
        color: {DARK_BG};
        font-weight: bold;
    }}
    QPushButton#commitRollBtn {{
        background-color: #050805;
        border: 2px solid {NEON_GREEN};
        border-radius: 10px;
        padding: 4px;
    }}
    QPushButton#commitRollBtn:hover {{
        background-color: #0d170d;
        border: 2px solid #8dff8d;
    }}
    QComboBox {{
        background-color: {INPUT_BG};
        color: {NEON_GREEN};
        border: 1px solid {BORDER_GREEN};
        border-radius: 3px;
        padding: 4px;
        min-width: 80px;
    }}
    QComboBox::drop-down {{
        border-left: 1px solid {BORDER_GREEN};
    }}
    QTableWidget {{
        background-color: {PANEL_BG};
        color: #e0e0e0;
        gridline-color: {BORDER_GREEN};
        border: 1px solid {BORDER_GREEN};
    }}
    QTableWidget::item {{
        padding: 4px;
    }}
    QListWidget {{
        background-color: #0a0f0a;
        color: #e8ffe8;
        border: 1px solid {BORDER_GREEN};
        border-radius: 4px;
        padding: 4px;
    }}
    QListWidget::item {{
        padding: 8px 10px;
        border-radius: 3px;
    }}
    QListWidget::item:selected {{
        background-color: #1e3d1e;
        color: {NEON_GREEN};
    }}
    QCheckBox {{
        color: #e8ffe8;
        spacing: 8px;
    }}
    QCheckBox::indicator {{
        width: 16px;
        height: 16px;
        background: #070b07;
        border: 1px solid {BORDER_GREEN};
        border-radius: 2px;
    }}
    QCheckBox::indicator:hover {{
        border: 1px solid {NEON_GREEN};
    }}
    QCheckBox::indicator:checked {{
        background: #070b07;
        border: 1px solid {NEON_GREEN};
        image: url(assets/icons/check_neon.svg);
    }}
    QCheckBox::indicator:unchecked {{
        background: #070b07;
    }}
    QHeaderView::section {{
        background-color: {INPUT_BG};
        color: {NEON_GREEN};
        border: 1px solid {BORDER_GREEN};
        padding: 6px;
    }}
    QScrollBar:vertical {{
        background: {PANEL_BG};
        width: 12px;
        border-radius: 6px;
        border: 1px solid {BORDER_GREEN};
    }}
    QScrollBar::handle:vertical {{
        background: {BORDER_GREEN};
        border-radius: 5px;
        min-height: 24px;
    }}
    QScrollBar:horizontal {{
        background: {PANEL_BG};
        height: 12px;
        border-radius: 6px;
        border: 1px solid {BORDER_GREEN};
    }}
    QScrollBar::handle:horizontal {{
        background: {BORDER_GREEN};
        border-radius: 5px;
        min-width: 24px;
    }}
    QScrollArea {{
        background-color: {PANEL_BG};
        border: 1px solid {BORDER_GREEN};
        border-radius: 4px;
    }}
    QAbstractSpinBox::up-button, QAbstractSpinBox::down-button {{
        width: 20px;
        border-left: 1px solid {BORDER_GREEN};
    }}
    QFrame#characterPanel {{
        background-color: #070b07;
        border: 1px solid {BORDER_GREEN};
        border-radius: 0px;
    }}
    QFrame#excelNameBar {{
        background-color: #050805;
        border: 1px solid {BORDER_GREEN};
        border-radius: 0px;
    }}
    QFrame#excelCell {{
        background-color: #050805;
        border: 1px solid {BORDER_GREEN};
        border-radius: 0px;
        padding: 0px;
    }}
    QPushButton#fichaStepBtn {{
        padding: 0px;
        min-width: 22px;
        max-width: 22px;
        min-height: 22px;
        font-weight: bold;
        font-size: 12px;
    }}
    QPushButton#checkRollBtn {{
        font-weight: bold;
        min-height: 28px;
    }}
    QFrame#characterPanel QPushButton:checked {{
        background-color: {NEON_GREEN};
        color: {DARK_BG};
    }}
    QFrame#characterPanel QPushButton#starBtn {{
        font-family: "Segoe UI Symbol", "DejaVu Sans", sans-serif;
        font-size: 18px;
    }}
    QFrame#characterPanel QPushButton#starBtn:checked {{
        background-color: #e6c200;
        color: {DARK_BG};
        border-color: #e6c200;
    }}
    QFrame#characterPanel QPushButton#statBtn {{
        padding: 0px;
        border: 1px solid {BORDER_GREEN};
        background-color: #0a0f0a;
    }}
    QFrame#characterPanel QPushButton#statBtn:hover {{
        border: 1px solid {NEON_GREEN};
        background-color: #122012;
    }}
    QFrame#characterPanel QLabel#diceModBox {{
        background-color: {INPUT_BG};
        border: 1px solid {BORDER_GREEN};
        border-radius: 0px;
        color: {NEON_GREEN};
        font-weight: bold;
        padding: 2px 4px;
        min-width: 1.2em;
    }}
    QFrame#headerSideBox {{
        background-color: #050805;
        border: 1px solid #66ff66;
        border-radius: 0px;
    }}
    QFrame#portraitBlock {{
        background-color: transparent;
        border: none;
    }}
    QFrame#characterPanel QLabel#headerDiceMain {{
        background-color: #070b07;
        border: 1px solid #66ff66;
        color: #66ff66;
        font-weight: bold;
        font-size: 12px;
        padding: 2px 4px;
        min-height: 22px;
    }}
    QFrame#characterPanel QLabel#headerModSub {{
        background-color: transparent;
        border: none;
        color: #9fdf9f;
        font-size: 9px;
        font-weight: bold;
        padding: 0px;
    }}
    QFrame#characterPanel QLabel#characterNameLbl {{
        color: #e8ffe8;
        font-size: 10px;
        font-weight: bold;
    }}
    QFrame#characterPanel QSpinBox#fichaTotalSpin {{
        padding: 1px 2px;
        font-weight: bold;
        font-size: 11px;
    }}
    QFrame#characterPanel QLabel#modTotalLbl {{
        background-color: #050805;
        border: 1px solid {BORDER_GREEN};
        color: {NEON_GREEN};
        font-weight: bold;
        font-size: 11px;
        min-width: 28px;
        padding: 2px 4px;
    }}
    QFrame#characterPanel QAbstractSpinBox,
    QFrame#characterPanel QLineEdit {{
        min-width: 26px;
        padding: 2px 4px;
        border-radius: 0px;
    }}
    QFrame#characterPanel QPlainTextEdit#rollComment {{
        background-color: #050805;
        color: #dfffdc;
        border: 1px solid {BORDER_GREEN};
        border-radius: 0px;
        padding: 4px 6px;
        font-size: 10px;
    }}
    QFrame#globalPanel {{
        background-color: {PANEL_BG};
        border: 2px solid {BORDER_GREEN};
        border-radius: 6px;
    }}
    QLabel#excelCellLabel {{
        color: #f2f2f2;
        font-size: 9px;
        font-weight: bold;
        letter-spacing: 0.4px;
        text-transform: uppercase;
    }}
    QFrame#excelStatBar {{
        border: 1px solid {BORDER_GREEN};
        background-color: #050805;
        border-radius: 0px;
    }}
    QFrame#characterPanel QFrame#explosionFollowStats {{
        background-color: #070b07;
        border: 1px solid {BORDER_GREEN};
        border-radius: 4px;
        margin-top: 4px;
    }}
    QFrame#characterPanel QFrame#explosionStepBlock {{
        background-color: #070b07;
        border: 1px solid {BORDER_GREEN};
        border-radius: 4px;
        margin-top: 2px;
    }}
    QFrame#excelExplotaBar {{
        border: 1px solid #66ff66;
        background-color: #050805;
        border-radius: 0px;
        min-height: 32px;
    }}
    QLabel#excelExplotaText {{
        padding: 2px 6px;
        font-size: 10px;
        font-weight: bold;
        color: #c8e6c8;
    }}
    QScrollArea#playersScroll {{
        border: 1px solid {BORDER_GREEN};
        border-radius: 4px;
    }}
    QScrollArea#playersScroll QScrollBar:horizontal {{
        height: 0px;
        max-height: 0px;
        border: none;
        background: transparent;
    }}
    QScrollArea#playersScroll QScrollBar::handle:horizontal {{
        min-width: 0px;
        background: transparent;
    }}
    QPlainTextEdit#rollLog {{
        border-radius: 0px;
    }}
    QWidget#launcherRoot {{
        background-color: {DARK_BG};
    }}
    QWidget#launcherRoot QSplitter::handle {{
        background-color: #1e2a1e;
        width: 3px;
    }}
    QWidget#launcherRoot QListWidget {{
        background-color: {INPUT_BG};
        color: #e8ffe8;
        border: 1px solid {BORDER_GREEN};
        border-radius: 4px;
        padding: 4px;
    }}
    QWidget#launcherRoot QListWidget::item {{
        padding: 8px 10px;
        border-radius: 3px;
    }}
    QWidget#launcherRoot QListWidget::item:selected {{
        background-color: #1e3d1e;
        color: {NEON_GREEN};
    }}
    QWidget#launcherRoot QListWidget::item:hover {{
        background-color: #152015;
    }}
    QFrame#menuCard {{
        background-color: #070b07;
        border: 1px solid {BORDER_GREEN};
        border-radius: 0px;
    }}
    QLabel#menuCardTitle {{
        color: {NEON_GREEN};
        font-weight: bold;
        font-size: 18px;
        letter-spacing: 0.6px;
        padding: 2px 0px;
    }}
    QLabel#menuCardSub {{
        color: #8fbf8f;
        font-size: 10px;
        padding-bottom: 2px;
    }}
    QListWidget#menuList {{
        background-color: #050805;
        color: #dfffdc;
        border: 1px solid {BORDER_GREEN};
        border-radius: 0px;
        padding: 2px;
    }}
    QListWidget#menuList::item {{
        padding: 6px 8px;
        border: 1px solid transparent;
    }}
    QListWidget#menuList::item:selected {{
        color: {NEON_GREEN};
        background-color: #0f1a0f;
        border: 1px solid {BORDER_GREEN};
    }}
"""
