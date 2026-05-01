"""
Punto de entrada: flujo V1 de mesas.
Inicio -> Crear/Cargar Mesa -> Mesa -> Tirada -> volver a Mesa.
"""
import sys
from pathlib import Path

from PySide6.QtWidgets import QApplication
from PySide6.QtNetwork import QLocalServer, QLocalSocket

# Asegurar que el directorio del proyecto esté en el path
ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from database import init_db
from ui.mesa_flow_window import MesaFlowWindow
from ui.theme import MAIN_STYLESHEET

SERVER_NAME = "DXD_RPG_Tiradas"


def main() -> int:
    init_db()
    app = QApplication(sys.argv)
    app.setApplicationName("RPG Tiradas")
    app.setStyleSheet(MAIN_STYLESHEET)

    socket = QLocalSocket()
    socket.connectToServer(SERVER_NAME)
    if socket.waitForConnected(500):
        socket.write(b"show")
        socket.flush()
        socket.disconnectFromServer()
        return 0

    win = MesaFlowWindow()

    server = QLocalServer(app)

    def bring_to_front() -> None:
        if server.hasPendingConnections():
            conn = server.nextPendingConnection()
            if conn:
                conn.close()
                conn.deleteLater()
        win.showNormal()
        win.raise_()
        win.activateWindow()

    if server.listen(SERVER_NAME):
        server.newConnection.connect(bring_to_front)

    win.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
