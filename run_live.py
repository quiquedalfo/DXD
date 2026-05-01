"""
Live reload: vigila cambios en .py (y opcionalmente en tema/estilos)
y reinicia la app automáticamente, como un "live server" para desarrollo.
Uso: python run_live.py
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

# Dependencia opcional para vigilar archivos
try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
except ImportError:
    print("Para live reload instala: pip install watchdog")
    sys.exit(1)

ROOT = Path(__file__).resolve().parent
MAIN_SCRIPT = ROOT / "main.py"


class RestartHandler(FileSystemEventHandler):
    """Reacciona a cambios en archivos y pide reinicio."""

    def __init__(self, runner: "LiveRunner"):
        super().__init__()
        self.runner = runner

    def on_modified(self, event):
        if event.is_directory:
            return
        path = Path(event.src_path)
        if path.suffix.lower() in (".py", ".qss", ".css"):
            self.runner.schedule_restart()


class LiveRunner:
    def __init__(self):
        self.process: subprocess.Popen | None = None
        self.restart_pending = False
        self.observer: Observer | None = None

    def schedule_restart(self):
        self.restart_pending = True

    def run_app(self) -> subprocess.Popen:
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        return subprocess.Popen(
            [sys.executable, str(MAIN_SCRIPT)],
            cwd=str(ROOT),
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=sys.stdout,
            stderr=sys.stderr,
        )

    def stop_app(self):
        if self.process is None:
            return
        try:
            self.process.terminate()
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
        except Exception:
            pass
        self.process = None

    def start_watcher(self):
        self.observer = Observer()
        handler = RestartHandler(self)
        self.observer.schedule(handler, str(ROOT), recursive=True)
        self.observer.start()

    def stop_watcher(self):
        if self.observer:
            self.observer.stop()
            self.observer.join(timeout=2)
            self.observer = None

    def run(self):
        print("Live reload activo. Guarda un .py (o .qss/.css) para reiniciar la app.")
        print("Salir: Ctrl+C\n")
        self.start_watcher()
        try:
            while True:
                self.restart_pending = False
                self.process = self.run_app()
                while self.process.poll() is None and not self.restart_pending:
                    time.sleep(0.3)
                self.stop_app()
                if not self.restart_pending:
                    break
                print("\n--- Reiniciando por cambios en archivos ---\n")
        except KeyboardInterrupt:
            pass
        finally:
            self.stop_app()
            self.stop_watcher()
        print("Live reload cerrado.")


def main():
    if not MAIN_SCRIPT.exists():
        print(f"No encontrado: {MAIN_SCRIPT}")
        sys.exit(1)
    runner = LiveRunner()
    runner.run()


if __name__ == "__main__":
    main()
