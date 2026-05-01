import type { SupabaseClient } from "@supabase/supabase-js";

export type ExplosionRpcMode = "spec" | "desktop";

export type SubmitCheckResponseRow = {
  response_id: string;
  computed_total: number;
  outcome: string;
  margin: number;
  explosion_flag: boolean;
  /** 1 si el check falló (+1 ficha); 0 si pasó. En éxito sin fichas gastadas el saldo no cambia; con fichas, solo el gasto. */
  fail_token_reward?: number;
  check_status: string;
};

export async function rpcCreateMatch(
  supabase: SupabaseClient,
  input: { title: string; code?: string | null },
): Promise<{ matchId: string }> {
  const { data, error } = await supabase.rpc("create_match", {
    p_title: input.title,
    p_code: input.code ?? null,
  });
  if (error) throw error;
  return { matchId: String(data) };
}

/** Código corto (`matches.code`) o UUID de la partida (`matches.id`). */
export async function rpcJoinMatchByCode(
  supabase: SupabaseClient,
  codeOrMatchId: string,
): Promise<{ matchId: string }> {
  const { data, error } = await supabase.rpc("join_match_with_code", { p_code: codeOrMatchId });
  if (error) throw error;
  return { matchId: String(data) };
}

/** Miembro de la partida (master o jugador): guarda la hoja elegida en `match_members.active_character_id`. */
export async function rpcSetPlayerActiveCharacterForMatch(
  supabase: SupabaseClient,
  input: { matchId: string; characterId: string },
): Promise<void> {
  const { error } = await supabase.rpc("set_player_active_character_for_match", {
    p_match_id: input.matchId,
    p_character_id: input.characterId,
  });
  if (error) throw error;
}

/** Miembro de la partida: latido de presencia para `connection_status` / `last_seen_at` (mesa del director). */
export async function rpcPingMatchPresence(
  supabase: SupabaseClient,
  input: { matchId: string },
): Promise<void> {
  const { error } = await supabase.rpc("ping_match_presence", { p_match_id: input.matchId });
  if (error) throw error;
}

/** Miembro autenticado: marca `offline` al salir de la mesa o antes de cerrar sesión (evita «En mesa» fantasma). */
export async function rpcLeaveMatchPresence(
  supabase: SupabaseClient,
  input: { matchId: string },
): Promise<void> {
  const { error } = await supabase.rpc("leave_match_presence", { p_match_id: input.matchId });
  if (error) throw error;
}

export async function rpcInvitePlayerToMatchByEmail(
  supabase: SupabaseClient,
  input: { matchId: string; email: string; characterId?: string | null },
): Promise<{ inviteId: string }> {
  const { data, error } = await supabase.rpc("invite_player_to_match_by_email", {
    p_match_id: input.matchId,
    p_email: input.email.trim(),
    p_character_id: input.characterId ?? null,
  });
  if (error) throw error;
  return { inviteId: String(data) };
}

export async function rpcRespondMatchInvite(
  supabase: SupabaseClient,
  input: { inviteId: string; accept: boolean },
): Promise<void> {
  const { error } = await supabase.rpc("respond_match_invite", {
    p_invite_id: input.inviteId,
    p_accept: input.accept,
  });
  if (error) throw error;
}

export type PlayerCharacterForMasterRow = {
  character_id: string;
  owner_user_id: string;
  character_name: string;
  owner_display: string;
  /** `user`, `master_npc` o `master_pet`; ver migración NPC/PET. */
  character_origin?: string | null;
};

/** Solo el master: hoja que cada jugador eligió para la partida (`match_members.active_character_id`). */
export async function rpcListPlayerCharactersForMaster(
  supabase: SupabaseClient,
  matchId: string,
): Promise<PlayerCharacterForMasterRow[]> {
  const { data, error } = await supabase.rpc("list_player_characters_for_master", {
    p_match_id: matchId,
  });
  if (error) throw error;
  return (data ?? []) as PlayerCharacterForMasterRow[];
}

export type MatchMemberSheetRow = {
  member_user_id: string;
  member_role: string;
  character_id: string | null;
  character_name: string | null;
  owner_display: string;
  /** Retrato del personaje; requiere migración `20260419120000_list_match_member_sheets_enriched.sql`. */
  avatar_url?: string | null;
  concept?: string | null;
  connection_status?: string;
  last_seen_at?: string | null;
  /** Fichas en mesa (`character_runtime`); migración `20260421143000_stat_training_tokens.sql`. */
  runtime_tokens?: number | null;
  /** `user` | `master_npc` | `master_pet` o null si aún sin hoja. */
  character_origin?: string | null;
};

/** Tabla mesa: cada miembro con rol y personaje elegido (si ya lo fijó en el celular). */
export async function rpcListMatchMemberSheetsForMaster(
  supabase: SupabaseClient,
  matchId: string,
): Promise<MatchMemberSheetRow[]> {
  const { data, error } = await supabase.rpc("list_match_member_sheets_for_master", {
    p_match_id: matchId,
  });
  if (error) throw error;
  return (data ?? []) as MatchMemberSheetRow[];
}

/** Solo el master: expulsa a un jugador de la partida (no puede expulsarse a sí mismo como creador). */
export async function rpcKickMemberFromMatch(
  supabase: SupabaseClient,
  input: { matchId: string; memberUserId: string },
): Promise<void> {
  const { error } = await supabase.rpc("kick_member_from_match", {
    p_match_id: input.matchId,
    p_user_id: input.memberUserId,
  });
  if (error) throw error;
}

/** Solo master: ajusta fichas (+/-) del runtime del personaje en esa partida. */
export async function rpcMasterGrantCharacterTokens(
  supabase: SupabaseClient,
  input: { matchId: string; characterId: string; amount: number },
): Promise<{ current_tokens: number; granted: number }> {
  const { data, error } = await supabase.rpc("master_grant_character_tokens", {
    p_match_id: input.matchId,
    p_character_id: input.characterId,
    p_amount: input.amount,
  });
  if (error) throw error;
  return data as { current_tokens: number; granted: number };
}

/** Dueño del personaje: compra el siguiente nivel de entrenamiento en un stat (fichas del runtime de la partida). */
export async function rpcPurchaseNextStatTraining(
  supabase: SupabaseClient,
  input: { matchId: string; characterId: string; statKey: string },
): Promise<{
  stat_key: string;
  training_tier: string;
  tokens_spent: number;
  current_tokens: number;
  training_modifier: number;
}> {
  const { data, error } = await supabase.rpc("purchase_next_stat_training", {
    p_match_id: input.matchId,
    p_character_id: input.characterId,
    p_stat_key: input.statKey,
  });
  if (error) throw error;
  return data as {
    stat_key: string;
    training_tier: string;
    tokens_spent: number;
    current_tokens: number;
    training_modifier: number;
  };
}

export async function rpcSubmitCheckResponse(
  supabase: SupabaseClient,
  input: {
    checkId: string;
    characterId: string;
    rollValue: number;
    tokensSpent?: number;
    modifierApplied?: number;
    userComment?: string | null;
    explosionMode?: ExplosionRpcMode;
    /** Segmentos post-tirada principal: `{ roll, tokens }[]` (regla desktop en RPC). */
    explosionSteps?: { roll: number; tokens: number }[];
  },
): Promise<SubmitCheckResponseRow> {
  const { data, error } = await supabase.rpc("submit_check_response_with_comment", {
    p_check_id: input.checkId,
    p_character_id: input.characterId,
    p_roll_value: input.rollValue,
    p_tokens_spent: input.tokensSpent ?? 0,
    p_modifier_applied: input.modifierApplied ?? 0,
    p_user_comment: input.userComment?.trim() || null,
    p_explosion_mode: input.explosionMode ?? "spec",
    p_explosion_steps: input.explosionSteps ?? [],
  });
  if (error) throw error;
  return data as SubmitCheckResponseRow;
}
