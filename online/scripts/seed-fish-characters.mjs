/**
 * Crea el personaje "Fish" (stats fijas) para una lista de emails, sin pegar SQL en el dashboard.
 *
 * Requiere en online/.env.local:
 *   SUPABASE_URL (o mismo valor que usás en apps)
 *   SUPABASE_SERVICE_ROLE_KEY  ← Settings → API → service_role (¡no la subas a git!)
 *
 * Uso (desde la carpeta online/):
 *   npm run seed:fish
 *   npm run seed:fish -- otro@mail.com
 *
 * Nota: los IDs en la base son UUID (obligatorio por el esquema). "Fish" es el nombre;
 * no se puede usar la palabra FISH como id de fila sin cambiar todo el modelo a texto.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_EMAILS = ["dalfoenrique@gmail.com", "usuarionxn2026@gmail.com"];

const STAT_ROWS = [
  { stat_key: "brawn", stat_label: "Brawn", die_size: "4" },
  { stat_key: "brains", stat_label: "Brains", die_size: "20" },
  { stat_key: "fight", stat_label: "Fight", die_size: "10" },
  { stat_key: "flight", stat_label: "Flight", die_size: "8" },
  { stat_key: "charm", stat_label: "Charm", die_size: "8" },
  { stat_key: "grit", stat_label: "Grit", die_size: "12" },
];

function loadEnvLocal() {
  const p = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(p)) {
    console.error("Falta online/.env.local");
    process.exit(1);
  }
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
}

async function findUserIdByEmail(adminClient, email) {
  const target = email.trim().toLowerCase();
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users ?? [];
    const hit = users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (hit) return hit.id;
    if (users.length < perPage) return null;
    page += 1;
    if (page > 50) return null;
  }
}

async function ensureFishForUser(svc, userId, label) {
  const { data: existing, error: e0 } = await svc
    .from("characters")
    .select("id,name")
    .eq("owner_user_id", userId)
    .eq("is_archived", false);
  if (e0) throw e0;
  const already = (existing ?? []).find((r) => r.name.trim().toLowerCase() === "fish");
  if (already) {
    console.log(`[skip] Ya existe Fish para ${label} (${already.id})`);
    return;
  }

  const { data: ch, error: e1 } = await svc
    .from("characters")
    .insert({ name: "Fish", owner_user_id: userId })
    .select("id")
    .single();
  if (e1) throw e1;
  const cid = ch.id;

  const statsRows = STAT_ROWS.map((s) => ({
    character_id: cid,
    stat_key: s.stat_key,
    stat_label: s.stat_label,
    die_size: s.die_size,
    base_modifier: 0,
  }));
  const { error: e2 } = await svc.from("character_stats").insert(statsRows);
  if (e2) throw e2;

  const { error: e3 } = await svc.from("character_resources").insert({
    character_id: cid,
    starting_tokens: 5,
    notes: "seed Fish (script)",
  });
  if (e3) throw e3;

  console.log(`[ok] Fish creado para ${label} → character_id=${cid}`);
}

async function main() {
  loadEnvLocal();
  const url = process.env.SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) {
    console.error(
      "Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en online/.env.local (la service_role está en Supabase → Settings → API).",
    );
    process.exit(1);
  }

  const emails =
    process.argv.length > 2 ? process.argv.slice(2).map((e) => e.trim()).filter(Boolean) : DEFAULT_EMAILS;

  const svc = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  for (const em of emails) {
    const uid = await findUserIdByEmail(svc, em);
    if (!uid) {
      console.warn(`[warn] No hay usuario en Auth con email: ${em} (crealo primero en Authentication → Users).`);
      continue;
    }
    try {
      await ensureFishForUser(svc, uid, em);
    } catch (e) {
      console.error(`[error] ${em}:`, e?.message ?? e);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
