/**
 * Crea un usuario de prueba en Supabase Auth (signUp) o verifica que exista (signIn).
 * No escribe contraseñas en disco: usá variables de entorno al invocar.
 *
 * Desde online/:
 *   PowerShell:
 *     $env:NEW_USER_EMAIL="salamito@gmail.com"; $env:NEW_USER_PASSWORD="..."; node scripts/create-auth-user.mjs
 *   bash:
 *     NEW_USER_EMAIL=salamito@gmail.com NEW_USER_PASSWORD='...' node scripts/create-auth-user.mjs
 *
 * Requiere online/.env.local con SUPABASE_URL y SUPABASE_ANON_KEY (igual que npm run smoke).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error("Falta online/.env.local (copiá desde .env.example).");
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
const anon = process.env.SUPABASE_ANON_KEY;
const email = (process.env.NEW_USER_EMAIL ?? "").trim();
const password = process.env.NEW_USER_PASSWORD ?? "";

if (!url || !anon) {
  console.error("Faltan SUPABASE_URL o SUPABASE_ANON_KEY en online/.env.local.");
  process.exit(1);
}
if (!email || !email.includes("@")) {
  console.error("Definí NEW_USER_EMAIL con un correo válido (ej. salamito@gmail.com).");
  process.exit(1);
}
if (password.length < 6) {
  console.error("NEW_USER_PASSWORD: Supabase suele exigir al menos 6 caracteres.");
  process.exit(1);
}

const client = createClient(url, anon);

const signIn = await client.auth.signInWithPassword({ email, password });
if (!signIn.error) {
  console.log("OK: el usuario ya existía; inicio de sesión correcto.");
  process.exit(0);
}

const signUp = await client.auth.signUp({
  email,
  password,
  options: { data: { username: email.split("@")[0] } },
});
if (signUp.error) {
  console.error("signUp:", signUp.error.message);
  if (/rate limit/i.test(signUp.error.message)) {
    console.error("Supabase limitó registros. Esperá unos minutos o creá el usuario en Authentication → Users.");
  }
  process.exit(1);
}

const again = await client.auth.signInWithPassword({ email, password });
if (again.error) {
  console.error(
    "Usuario creado pero no se pudo iniciar sesión:",
    again.error.message,
    "\nSi tu proyecto exige confirmar email, desactivá la confirmación en Auth o confirmá el usuario en el dashboard.",
  );
  process.exit(1);
}

console.log("OK: usuario creado e inicio de sesión verificado.");
process.exit(0);
