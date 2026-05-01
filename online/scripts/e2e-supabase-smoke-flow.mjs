/**
 * E2E contra Supabase: create_match → join → personaje mínimo → check → submit_check_response.
 * Requiere online/.env.local (ver .env.example). Ejecutar desde online/: `npm run smoke`
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
    process.env[key] = value;
  }
}

loadEnvLocal();

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
const masterEmail = process.env.MASTER_EMAIL;
const masterPassword = process.env.MASTER_PASSWORD;
const playerEmail = process.env.PLAYER_EMAIL;
const playerPassword = process.env.PLAYER_PASSWORD;

if (!url || !anon || !masterEmail || !masterPassword || !playerEmail || !playerPassword) {
  const missing = [
    !url && "SUPABASE_URL",
    !anon && "SUPABASE_ANON_KEY",
    !masterEmail && "MASTER_EMAIL",
    !masterPassword && "MASTER_PASSWORD",
    !playerEmail && "PLAYER_EMAIL",
    !playerPassword && "PLAYER_PASSWORD",
  ].filter(Boolean);
  console.error("Faltan o están vacías en online/.env.local:", missing.join(", "));
  process.exit(1);
}

/** Mismo orden que el enum Postgres `stat_key` y `STAT_KEYS` en @dxd/shared. */
const STAT_KEYS = ["brains", "brawn", "fight", "flight", "charm", "grit"];

async function ensureUser(email, password) {
  const c = createClient(url, anon);
  const signIn = await c.auth.signInWithPassword({ email, password });
  if (!signIn.error) return c;

  const signUp = await c.auth.signUp({
    email,
    password,
    options: { data: { username: email.split("@")[0] } },
  });
  if (signUp.error) {
    console.error("signUp", email, signUp.error.message);
    if (/rate limit/i.test(signUp.error.message)) {
      console.error(
        "Supabase frenó varios signUp seguidos. Esperá unos minutos (a veces ~1 h) o creá los dos usuarios a mano en Authentication → Users con los mismos mails y contraseñas que en .env.local; el smoke hará signIn y no dependerá del registro.",
      );
    }
    process.exit(1);
  }
  const again = await c.auth.signInWithPassword({ email, password });
  if (again.error) {
    console.error(
      "No se pudo iniciar sesión tras signUp. Si pide confirmar email, desactivá confirmación en Auth o confirmá el usuario en el dashboard.",
      again.error.message,
    );
    process.exit(1);
  }
  return c;
}

async function main() {
  console.log("1) Master: sesión + create_match");
  const master = await ensureUser(masterEmail, masterPassword);
  const { data: matchId, error: e1 } = await master.rpc("create_match", {
    p_title: `Smoke ${new Date().toISOString()}`,
    p_code: null,
  });
  if (e1) {
    console.error("create_match", e1);
    process.exit(1);
  }

  const { data: matchRow, error: e2 } = await master.from("matches").select("code,title").eq("id", matchId).single();
  if (e2) {
    console.error("select match", e2);
    process.exit(1);
  }
  console.log("   Partida:", matchId, "código:", matchRow.code);

  console.log("2) Jugador: join por código");
  const player = await ensureUser(playerEmail, playerPassword);
  const { data: joinedId, error: e3 } = await player.rpc("join_match_with_code", { p_code: matchRow.code });
  if (e3) {
    console.error("join_match_with_code", e3);
    process.exit(1);
  }
  if (String(joinedId) !== String(matchId)) {
    console.error("join devolvió otro match_id", joinedId, matchId);
    process.exit(1);
  }

  const { data: userData } = await player.auth.getUser();
  const playerId = userData.user?.id;
  if (!playerId) {
    console.error("Sin jugador auth");
    process.exit(1);
  }

  console.log("3) Jugador: personaje + stats + recursos");
  const { data: ch, error: e4 } = await player
    .from("characters")
    .insert({ name: "PJ smoke", owner_user_id: playerId })
    .select("id")
    .single();
  if (e4) {
    console.error("insert character", e4);
    process.exit(1);
  }
  const characterId = ch.id;

  const statsRows = STAT_KEYS.map((k) => ({
    character_id: characterId,
    stat_key: k,
    stat_label: k,
    die_size: "20",
    base_modifier: 0,
  }));
  const { error: e5 } = await player.from("character_stats").insert(statsRows);
  if (e5) {
    console.error("insert character_stats", e5);
    process.exit(1);
  }

  const { error: e6 } = await player
    .from("character_resources")
    .insert({ character_id: characterId, starting_tokens: 5, notes: "smoke" });
  if (e6) {
    console.error("insert character_resources", e6);
    process.exit(1);
  }

  const { data: masterUser } = await master.auth.getUser();
  const masterId = masterUser.user?.id;
  if (!masterId) {
    console.error("Sin master auth");
    process.exit(1);
  }

  console.log("4) Master: asignación + runtime + check + target");
  const { error: e7 } = await master.from("match_characters").insert({
    match_id: matchId,
    user_id: playerId,
    character_id: characterId,
    is_active: true,
    assigned_by_master_user_id: masterId,
  });
  if (e7) {
    console.error("insert match_characters", e7);
    process.exit(1);
  }

  const { error: e8 } = await master.from("character_runtime").insert({
    match_id: matchId,
    character_id: characterId,
    current_tokens: 5,
    current_modifier: 0,
    check_status: "idle",
    last_result: "none",
  });
  if (e8) {
    console.error("insert character_runtime", e8);
    process.exit(1);
  }

  const { data: chk, error: e9 } = await master
    .from("checks")
    .insert({
      match_id: matchId,
      target_scope: "single_player",
      created_by_user_id: masterId,
      stat_key: "brains",
      stat_label_at_time: "Brains",
      check_value: 10,
      allow_token_spend: true,
      allow_manual_modifier: true,
      status: "open",
    })
    .select("id")
    .single();
  if (e9) {
    console.error("insert checks", e9);
    process.exit(1);
  }
  const checkId = chk.id;

  const { error: e10 } = await master.from("check_targets").insert({
    check_id: checkId,
    user_id: playerId,
    character_id: characterId,
    response_status: "pending",
  });
  if (e10) {
    console.error("insert check_targets", e10);
    process.exit(1);
  }

  console.log("5) Jugador: submit_check_response (8 + 1 ficha + 2 mod = 11 vs DC 10 → pass)");
  const { data: res, error: e11 } = await player.rpc("submit_check_response", {
    p_check_id: checkId,
    p_character_id: characterId,
    p_roll_value: 8,
    p_tokens_spent: 1,
    p_modifier_applied: 2,
    p_explosion_mode: "spec",
  });
  if (e11) {
    console.error("submit_check_response", e11);
    process.exit(1);
  }

  console.log("   Resultado RPC:", res);

  const { data: row } = await master.from("check_responses").select("*").eq("check_id", checkId).maybeSingle();
  console.log("6) Verificación check_responses (vista master):", row ? "OK fila" : "sin fila");

  console.log("Listo. Revisá Table Editor: matches, match_members, check_responses, character_runtime.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
