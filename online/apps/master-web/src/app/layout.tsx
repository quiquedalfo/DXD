import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DXD — Master",
  description: "Crear partida (MVP online)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
