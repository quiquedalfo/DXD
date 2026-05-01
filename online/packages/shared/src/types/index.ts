/**
 * Tipos compartidos (alineados al spec Supabase + dominio).
 * Mismas 6 claves que el desktop Python (`core.models.STAT_KEYS`): el **orden** acá
 * coincide con el enum Postgres `stat_key` (migración inicial); en Python el tuple
 * usa otro orden solo para presentación legacy tipo Excel.
 */

export const STAT_KEYS = [
  "brains",
  "brawn",
  "fight",
  "flight",
  "charm",
  "grit",
] as const;

export type StatKey = (typeof STAT_KEYS)[number];

/** Columna `character_stats.training_tier` (enum Postgres). */
export type StatTrainingTier = "none" | "trained_in" | "studied_in" | "master_in";

export type DieSize = 4 | 6 | 8 | 10 | 12 | 20;

export type MatchStatus = "draft" | "live" | "paused" | "finished" | "archived";

export type MatchMemberRole = "master" | "player";

/** Origen de la hoja (`public.characters.origin`). */
export type CharacterOrigin = "user" | "master_npc" | "master_pet";

export type ConnectionStatus = "offline" | "online";

export type CheckTargetScope = "single_player" | "multiple_players" | "all_players";

export type CheckEntityStatus = "open" | "answered" | "resolved" | "cancelled";

export type CheckTargetResponseStatus =
  | "pending"
  | "submitted"
  | "approved"
  | "rejected"
  | "timeout";

export type RuntimeCheckStatus =
  | "idle"
  | "waiting_response"
  | "responded"
  | "resolved"
  | "cancelled";

export type RollOutcome = "pass" | "fail" | "none";

export type JsonObject = Record<string, unknown>;

/** Fila `public.profiles` */
export type ProfileRow = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

/** Fila `public.characters` */
export type CharacterRow = {
  id: string;
  owner_user_id: string;
  name: string;
  avatar_url: string | null;
  concept: string | null;
  is_archived: boolean;
  /** Migración `20260501180000_character_origin_npc_pet.sql`. */
  origin?: CharacterOrigin;
  created_at: string;
  updated_at: string;
};

/** Fila `public.character_stats` */
export type CharacterStatRow = {
  id: string;
  character_id: string;
  stat_key: StatKey;
  stat_label: string;
  die_size: DieSize;
  base_modifier: number;
  /** Migración `20260421143000_stat_training_tokens.sql`. */
  training_tier?: StatTrainingTier | null;
  created_at: string;
  updated_at: string;
};

/** Fila `public.character_resources` */
export type CharacterResourcesRow = {
  id: string;
  character_id: string;
  starting_tokens: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

/** Fila `public.matches` */
export type MatchRow = {
  id: string;
  code: string;
  title: string;
  master_user_id: string;
  status: MatchStatus;
  current_scene_text: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  ended_at: string | null;
};

/** Fila `public.match_members` */
export type MatchMemberRow = {
  id: string;
  match_id: string;
  user_id: string;
  role: MatchMemberRole;
  joined_at: string;
  connection_status: ConnectionStatus;
  last_seen_at: string | null;
};

/** Fila `public.match_characters` */
export type MatchCharacterRow = {
  id: string;
  match_id: string;
  user_id: string;
  character_id: string;
  is_active: boolean;
  assigned_by_master_user_id: string;
  created_at: string;
};

/** Fila `public.character_runtime` */
export type CharacterRuntimeRow = {
  id: string;
  match_id: string;
  character_id: string;
  current_tokens: number;
  current_modifier: number;
  current_check_value: number | null;
  current_check_stat_key: StatKey | null;
  current_check_prompt: string | null;
  check_status: RuntimeCheckStatus;
  last_roll_value: number | null;
  last_total_value: number | null;
  last_result: RollOutcome;
  last_margin: number | null;
  version: number;
  updated_at: string;
};

/** Fila `public.checks` */
export type CheckRow = {
  id: string;
  match_id: string;
  target_scope: CheckTargetScope;
  created_by_user_id: string;
  stat_key: StatKey;
  stat_label_at_time: string;
  check_value: number;
  prompt_text: string | null;
  instructions_text: string | null;
  allow_token_spend: boolean;
  allow_manual_modifier: boolean;
  status: CheckEntityStatus;
  created_at: string;
  resolved_at: string | null;
};

/** Fila `public.check_targets` */
export type CheckTargetRow = {
  id: string;
  check_id: string;
  user_id: string;
  character_id: string;
  response_status: CheckTargetResponseStatus;
  created_at: string;
  responded_at: string | null;
};

export type CheckResponseOutcome = "pass" | "fail";

/** Fila `public.check_responses` */
export type CheckResponseRow = {
  id: string;
  check_id: string;
  user_id: string;
  character_id: string;
  stat_key: StatKey;
  die_size_at_time: DieSize;
  roll_value: number;
  tokens_spent: number;
  modifier_applied: number;
  computed_total: number;
  target_value: number;
  outcome: CheckResponseOutcome;
  margin: number;
  explosion_flag: boolean;
  submitted_at: string;
  reviewed_by_master: boolean;
  reviewed_at: string | null;
};

/** Fila `public.match_events` */
export type MatchEventRow = {
  id: string;
  match_id: string;
  actor_user_id: string | null;
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
  payload_json: JsonObject;
  created_at: string;
};
