/**
 * Borra un usuario de Supabase Auth por email (requiere service_role).
 *
 * 1) Supabase → Settings → API → copiá «service_role» (secreta).
 * 2) En online/.env.local agregá una línea (no la subas a git):
 *    SUPABASE_SERVICE_ROLE_KEY=eyJ...
 *
 * Desde online/:
 *   PowerShell:
 *     $env:DELETE_AUTH_EMAIL="salamito@gmail.com"; node scripts/delete-auth-user-by-email.mjs
 *
 * Sin service_role: borrá el usuario a mano en Authentication → Users.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error("Falta online/.env.local");
    process.exit(1);
  }
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvLocal();

const url = process.env.SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = (process.env.DELETE_AUTH_EMAIL ?? "").trim().toLowerCase();

if (!url || !serviceRole) {
  console.error("Necesitás SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en online/.env.local");
  console.error("(o pasalos por entorno). Sin service_role, borrá el usuario en el dashboard.");
  process.exit(1);
}
if (!email || !email.includes("@")) {
  console.error("Definí DELETE_AUTH_EMAIL con el correo exacto del usuario a borrar.");
  process.exit(1);
}

const admin = createClient(url, serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let deleted = false;
for (let page = 1; page <= 20; page += 1) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) {
    console.error("listUsers:", error.message);
    process.exit(1);
  }
  const users = data?.users ?? [];
  const u = users.find((x) => (x.email ?? "").toLowerCase() === email);
  if (u) {
    const { error: delErr } = await admin.auth.admin.deleteUser(u.id);
    if (delErr) {
      console.error("deleteUser:", delErr.message);
      process.exit(1);
    }
    console.log("OK: usuario eliminado:", email, "(" + u.id + ")");
    deleted = true;
    break;
  }
  if (users.length < 200) break;
}

if (!deleted) {
  console.log("No se encontró ningún usuario con email:", email);
  process.exit(0);
}

process.exit(0);
