import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DXD — Master",
  description: "Crear partida (MVP online)",
};

/** Evita que `next build` se quede en "Generating static pages (0/4)" en hosts como Vercel (SPA cliente + Supabase). */
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
