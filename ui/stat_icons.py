"""
Iconos para las stats: brazo, cerebro, espadas, camaleón, cara con corazones, escudo.
Dibujados con QPainter (sin SVG) para que se vean en todos los sistemas.
"""
from PySide6.QtCore import QPointF, QRectF, QSize, Qt
from PySide6.QtGui import QColor, QIcon, QPainter, QPen, QPixmap

# Tamaño base de dibujo (coordenadas internas)
_SIZE = 24

_STATS = ("Brawn", "Brains", "Fight", "Flight", "Charm", "Grit")


def _pixmap_icon(draw_func, color: str, size: int = 24) -> QIcon:
    """Crea un QIcon dibujando con draw_func(painter, w) en color."""
    pix = QPixmap(size, size)
    pix.fill(Qt.GlobalColor.transparent)
    p = QPainter(pix)
    p.setRenderHint(QPainter.RenderHint.Antialiasing)
    p.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)
    pen = QPen(QColor(color))
    pen.setWidth(max(3, size // 8))
    pen.setCapStyle(Qt.RoundCap)
    pen.setJoinStyle(Qt.RoundJoin)
    p.setPen(pen)
    p.setBrush(Qt.NoBrush)
    scale = size / _SIZE
    p.scale(scale, scale)
    draw_func(p)
    p.end()
    return QIcon(pix)


def _draw_brawn(p: QPainter) -> None:
    # Brazo flexionado (bíceps): brazo que sube hacia el hombro
    p.drawLine(6, 18, 10, 12)
    p.drawLine(10, 12, 14, 10)
    p.drawLine(14, 10, 18, 14)
    p.drawLine(18, 14, 18, 20)
    p.drawEllipse(13, 8, 4, 4)  # bíceps


def _draw_brains(p: QPainter) -> None:
    # Cerebro: dos lóbulos
    p.drawEllipse(4, 6, 7, 10)
    p.drawEllipse(13, 6, 7, 10)
    p.drawLine(11, 12, 13, 12)
    p.drawLine(10, 16, 14, 16)


def _draw_fight(p: QPainter) -> None:
    # Dos espadas cruzadas
    p.drawLine(5, 5, 19, 19)
    p.drawLine(19, 5, 5, 19)
    p.drawRect(4, 4, 4, 4)
    p.drawRect(16, 4, 4, 4)
    p.drawRect(4, 16, 4, 4)
    p.drawRect(16, 16, 4, 4)


def _draw_flight(p: QPainter) -> None:
    # Camaleón: cuerpo + cola en espiral
    p.drawEllipse(6, 8, 10, 6)
    p.drawLine(14, 11, 18, 10)
    p.drawLine(18, 10, 20, 12)
    p.drawLine(20, 12, 18, 14)
    p.drawLine(18, 14, 14, 13)
    p.drawLine(8, 14, 6, 18)
    p.drawLine(6, 18, 8, 20)


def _draw_charm(p: QPainter) -> None:
    # Cara con corazones como ojos (corazón = dos círculos + triángulo)
    p.drawEllipse(4, 4, 16, 16)  # cara
    # Ojo corazón izquierdo (dos círculos superpuestos)
    p.drawEllipse(6, 7, 4, 4)
    p.drawEllipse(8, 7, 4, 4)
    p.drawLine(7, 11, 11, 11)
    # Ojo corazón derecho
    p.drawEllipse(12, 7, 4, 4)
    p.drawEllipse(14, 7, 4, 4)
    p.drawLine(13, 11, 17, 11)
    # Sonrisa
    p.drawArc(QRectF(8, 10, 8, 6), 0, 180 * 16)


def _draw_grit(p: QPainter) -> None:
    # Escudo (forma heater): polígono
    pts = [
        QPointF(12, 2),
        QPointF(20, 6),
        QPointF(20, 12),
        QPointF(12, 22),
        QPointF(4, 12),
        QPointF(4, 6),
    ]
    p.drawPolygon(pts)


_DRAWERS = {
    "Brawn": _draw_brawn,
    "Brains": _draw_brains,
    "Fight": _draw_fight,
    "Flight": _draw_flight,
    "Charm": _draw_charm,
    "Grit": _draw_grit,
}


def get_stat_icon(stat_name: str, color: str = "#cccccc", size: int = 22) -> QIcon:
    """Devuelve el icono para la stat (Brawn, Brains, Fight, Flight, Charm, Grit)."""
    draw = _DRAWERS.get(stat_name)
    if not draw:
        return QIcon()
    return _pixmap_icon(draw, color, size)


def get_stat_icon_with_states(
    stat_name: str,
    color_off: str = "#cccccc",
    color_on: str = "#0d120d",
    size: int = 22,
) -> QIcon:
    """Icono con estado normal y seleccionado (para botones checkables)."""
    icon_off = get_stat_icon(stat_name, color_off, size)
    icon_on = get_stat_icon(stat_name, color_on, size)
    combined = QIcon()
    sz = QSize(size, size)
    combined.addPixmap(icon_off.pixmap(sz), QIcon.Mode.Normal, QIcon.State.Off)
    combined.addPixmap(icon_on.pixmap(sz), QIcon.Mode.Normal, QIcon.State.On)
    return combined


def stat_icon_size() -> QSize:
    """Tamaño recomendado para mostrar el icono en el botón."""
    return QSize(22, 22)
