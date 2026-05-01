"""
Rutas de la aplicación: desarrollo vs ejecutable empaquetado (PyInstaller).
Recursos (Imagenes) pueden ir en _MEIPASS; datos de usuario (BD) en AppData.
"""
import os
import sys
from pathlib import Path


def is_frozen() -> bool:
    return getattr(sys, "frozen", False)


def resource_dir() -> Path:
    """Carpeta donde está el .exe o el script main.py."""
    if is_frozen():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


def bundled_dir() -> Path:
    """Carpeta de recursos embebidos (onefile: _MEIPASS)."""
    if is_frozen() and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)
    return resource_dir()


def imagenes_dir() -> Path:
    d = bundled_dir() / "Imagenes"
    if d.is_dir():
        return d
    return resource_dir() / "Imagenes"


def user_data_dir() -> Path:
    """Directorio escribible para BD y ajustes (necesario en .exe)."""
    if is_frozen():
        base = os.environ.get("APPDATA") or str(Path.home())
        p = Path(base) / "DXD_Tiradas"
        p.mkdir(parents=True, exist_ok=True)
        return p
    return resource_dir()


def db_path() -> Path:
    return user_data_dir() / "rpg_logs.db"
