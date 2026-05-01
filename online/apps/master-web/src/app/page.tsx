"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Icon from "@mdi/react";
import {
  mdiArmFlex,
  mdiBrain,
  mdiEmoticonKiss,
  mdiShieldOutline,
  mdiSnake,
  mdiStar,
  mdiStarOutline,
  mdiSwordCross,
} from "@mdi/js";
import {
  buildLoginEmail,
  createBrowserSupabaseClient,
  LOGIN_EMAIL_CUSTOM,
  LOGIN_EMAIL_DOMAIN_SUFFIXES,
  parseLoginEmail,
  pushRecentLoginEmail,
  RECENT_LOGIN_EMAILS_KEY,
  rpcCreateMatch,
  rpcInvitePlayerToMatchByEmail,
  rpcKickMemberFromMatch,
  rpcLeaveMatchPresence,
  rpcListMatchMemberSheetsForMaster,
  rpcListPlayerCharactersForMaster,
  rpcMasterGrantCharacterTokens,
  STAT_KEYS,
  effectiveStatModifier,
  mapVisibleStatLabel,
} from "@dxd/shared";
import type {
  CharacterOrigin,
  MatchMemberSheetRow,
  PlayerCharacterForMasterRow,
  StatKey,
  StatTrainingTier,
} from "@dxd/shared";
import {
  MesaCharacterGrid,
  type CharacterStatPreview,
  type MesaPendingInvite,
} from "@/components/MesaCharacterGrid";
import { D20LoadingOverlay } from "@/components/D20LoadingOverlay";
import { STRENGTHS_I_REFERENCE, STRENGTHS_II_REFERENCE } from "@/data/strengthReference";

function createSupabaseFromNextPublicEnv() {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en apps/master-web/.env.local. Guardá el archivo y reiniciá `npm run dev:master-web`.",
    );
  }
  return createBrowserSupabaseClient({ supabaseUrl, supabaseAnonKey });
}

/** Refetch automático en mesa activa: miembros, hojas e invitaciones (ms). */
const MESA_AUTO_REFRESH_MS = 3000;
const MASTER_ACTIVE_MATCH_KEY = "dxd.master.activeMatch.v1";
/** Notas en `character_resources` (legibles en SQL). El origen canónico es `characters.origin`. */
const MASTER_NPC_NOTE = "[DXD_NPC]";
const MASTER_PET_NOTE = "[DXD_PET]";
const BLANK_AVATAR_BUCKET = "character-avatars";

/** PostgREST suele devolver FKs many-to-one como objeto; a veces como array de un elemento. */
function unwrapEmbedded<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function formatUnknownError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    if (typeof o.message === "string" && o.message.trim()) return o.message;
    if (typeof o.error_description === "string" && o.error_description.trim()) return o.error_description;
    if (typeof o.details === "string" && o.details.trim()) return o.details;
    if (typeof o.hint === "string" && o.hint.trim()) return o.hint;
    try {
      return JSON.stringify(o);
    } catch {
      return "Error desconocido";
    }
  }
  return String(e);
}

type MemberRow = {
  user_id: string;
  role: string;
  profiles: { username: string; display_name: string } | null;
};

type SavedMatchRow = {
  id: string;
  code: string;
  title: string;
  status: string;
  created_at: string;
  master_user_id: string;
  current_scene_text: string | null;
  chapter_upgrades_open: boolean;
  chapter_index?: number;
};

type MasterTemplateCharacter = {
  id: string;
  name: string;
  avatarUrl: string | null;
  inMesa: boolean;
  origin: Extract<CharacterOrigin, "master_npc" | "master_pet">;
  /** PET cedido a este jugador en la mesa (si aplica). */
  grantedToLabel: string | null;
};

const EMPTY_BLANK_DICE: Record<StatKey, string> = {
  brains: "4",
  brawn: "4",
  fight: "4",
  flight: "4",
  charm: "4",
  grit: "4",
};
const BLANK_DICE_OPTIONS = ["4", "6", "8", "10", "12", "20"] as const;
const EMPTY_BLANK_TRAINING: Record<StatKey, StatTrainingTier> = {
  brains: "none",
  brawn: "none",
  fight: "none",
  flight: "none",
  charm: "none",
  grit: "none",
};
const BLANK_TRAINING_OPTIONS: ReadonlyArray<{ value: StatTrainingTier; label: string }> = [
  { value: "trained_in", label: "TI" },
  { value: "studied_in", label: "SI" },
  { value: "master_in", label: "MI" },
];

type CheckLogRow = {
  id: string;
  submitted_at: string;
  chapter_index?: number;
  character_id: string;
  die_size_at_time: string;
  roll_value: number;
  stat_key: string;
  tokens_spent: number;
  modifier_applied: number;
  computed_total: number;
  target_value: number;
  outcome: string;
  margin: number;
  explosion_flag: boolean;
  explosion_steps?: unknown;
  user_comment: string | null;
  check:
    | {
        check_value: number;
        stat_label_at_time: string | null;
        prompt_text: string | null;
        instructions_text: string | null;
        important?: boolean | null;
      }
    | {
        check_value: number;
        stat_label_at_time: string | null;
        prompt_text: string | null;
        instructions_text: string | null;
        important?: boolean | null;
      }[]
    | null;
  character: { name: string | null } | { name: string | null }[] | null;
};

type MesaRowForLog = { character_id: string | null; character_name?: string | null };

function deriveCheckLogDisplay(r: CheckLogRow, mesaRows: readonly MesaRowForLog[]) {
  const checkRow = unwrapEmbedded(r.check);
  const characterRow = unwrapEmbedded(r.character);
  const characterLabel =
    characterRow?.name?.trim() ||
    mesaRows.find((m) => m.character_id === r.character_id)?.character_name?.trim() ||
    `Personaje ${r.character_id ? r.character_id.slice(0, 8) : "—"}…`;
  const checkValue = Number(checkRow?.check_value ?? r.target_value ?? 0);
  const statLabel = (
    checkRow?.stat_label_at_time?.trim() ||
    mapVisibleStatLabel(r.stat_key as StatKey, null) ||
    r.stat_key ||
    "—"
  ).toString();
  const roll = Number(r.roll_value ?? 0);
  const tokens = Number(r.tokens_spent ?? 0);
  const modifier = Number(r.modifier_applied ?? 0);
  const total = Number(r.computed_total ?? 0);
  const margin = Number(r.margin ?? 0);
  const explodeLong = r.explosion_flag ? "EXPLOTO" : "NO EXPLOTO";
  const explodeShort = r.explosion_flag ? "Sí" : "No";
  const oc = String(r.outcome ?? "").toLowerCase();
  const passLabel =
    oc === "pass" ? "PASO" : oc === "fail" ? "NO PASO" : String(r.outcome ?? "—");
  const checkOutcome: "pass" | "fail" | "other" =
    oc === "pass" ? "pass" : oc === "fail" ? "fail" : "other";
  const finalResult = `${total} vs ${checkValue}`;
  const dieRaw = String(r.die_size_at_time ?? "").trim();
  const dieAtTime = dieRaw ? `D${dieRaw}` : "—";
  const masterComment =
    checkRow?.instructions_text?.trim() || checkRow?.prompt_text?.trim() || "—";
  const userComment = r.user_comment?.trim() || "—";
  const importantStar = checkRow?.important ? "⭐" : "";
  let rawSteps: unknown[] = [];
  const es = r.explosion_steps;
  if (Array.isArray(es)) {
    rawSteps = es;
  } else if (typeof es === "string" && es.trim()) {
    try {
      const p = JSON.parse(es) as unknown;
      if (Array.isArray(p)) rawSteps = p;
    } catch {
      rawSteps = [];
    }
  }
  const stepRows = rawSteps
    .map((s) => {
      if (!s || typeof s !== "object") return null;
      const rec = s as { roll?: unknown; tokens?: unknown };
      const roll = Number(rec.roll);
      const tokens = Number(rec.tokens);
      return {
        roll: Number.isFinite(roll) && roll > 0 ? roll : null,
        tokens: Number.isFinite(tokens) && tokens >= 0 ? tokens : null,
      };
    })
    .filter((n): n is { roll: number | null; tokens: number | null } => n != null);
  const ex1 = stepRows[0]?.roll ?? null;
  const ex1Tokens = stepRows[0]?.tokens ?? null;
  const ex2 = stepRows[1]?.roll ?? null;
  const ex2Tokens = stepRows[1]?.tokens ?? null;
  const ex3 = stepRows[2]?.roll ?? null;
  const ex3Tokens = stepRows[2]?.tokens ?? null;
  const ex4 = stepRows[3]?.roll ?? null;
  const ex4Tokens = stepRows[3]?.tokens ?? null;
  const explodeCount = r.explosion_flag ? Math.max(stepRows.length, 1) : 0;
  const explodeSummary = explodeCount > 0 ? `${explodeCount}` : "";
  const trainingShort =
    modifier === 1 ? "TI"
    : modifier === 3 ? "SI"
    : modifier === 5 ? "MI"
    : "—";
  const modifierLabel = modifier >= 0 ? `+${modifier}` : String(modifier);
  const passSentence =
    oc === "pass" ? "pasó"
    : oc === "fail" ? "no pasó"
    : String(r.outcome ?? "—");
  const explodeSentence =
    explodeCount > 0 ? `Explotó ${explodeCount} ${explodeCount === 1 ? "vez" : "veces"}.` : "No explotó.";
  const when = new Date(r.submitted_at).toLocaleString("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
  });
  const chapterIndex = Math.max(1, Math.floor(Number(r.chapter_index ?? 1)));
  return {
    chapterIndex,
    characterLabel,
    checkValue,
    statLabel,
    roll,
    tokens,
    modifier,
    total,
    margin,
    explodeLong,
    explodeShort,
    passLabel,
    checkOutcome,
    finalResult,
    dieAtTime,
    masterComment,
    userComment,
    importantStar,
    ex1,
    ex1Tokens,
    ex2,
    ex2Tokens,
    ex3,
    ex3Tokens,
    ex4,
    ex4Tokens,
    explodeCount,
    explodeSummary,
    trainingShort,
    modifierLabel,
    passSentence,
    explodeSentence,
    when,
  };
}

function csvCell(v: string | number): string {
  const s = String(v ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Tirada principal o explosión: cara del dado y fichas usadas (siempre visibles si hay dado). */
function RollHistoryDiceFichasCell({
  roll,
  tokens,
}: {
  roll: number | null;
  tokens: number | null;
}) {
  const hasRoll = roll != null && Number.isFinite(roll) && roll > 0;
  const tok = tokens != null && Number.isFinite(tokens) ? Math.max(0, Math.floor(Number(tokens))) : 0;
  if (!hasRoll) {
    if (tok > 0) {
      return (
        <span className="roll-history-table__dice-fichas">
          <span className="roll-history-table__dice-line">—</span>
          <span className="roll-history-table__fichas-line">{tok} fichas</span>
        </span>
      );
    }
    return <span className="roll-history-table__empty">—</span>;
  }
  return (
    <span className="roll-history-table__dice-fichas">
      <span className="roll-history-table__dice-line">Dado {roll}</span>
      <span className="roll-history-table__fichas-line">{tok} fichas</span>
    </span>
  );
}

/** Mesa activa en memoria + `current_scene_text` (descripción editable por el master). */
type ActiveMatchState = {
  id: string;
  code: string;
  title: string;
  masterUserId: string;
  currentSceneText: string | null;
  status: string;
  chapterUpgradesOpen: boolean;
  /** Capítulo actual de la mesa (1-based); se incrementa al pulsar «Terminar capítulo». */
  chapterIndex: number;
};

/** Mismos glifos que la app móvil (`MaterialCommunityIcons` en `PlayerTableScreen`). */
const STAT_ICON_PATHS: Record<StatKey, string> = {
  brains: mdiBrain,
  brawn: mdiArmFlex,
  charm: mdiEmoticonKiss,
  fight: mdiSwordCross,
  flight: mdiSnake,
  grit: mdiShieldOutline,
};

const STAT_UI_LABELS: Record<StatKey, string> = {
  brains: "Brains",
  brawn: "Brawn",
  charm: "Charm",
  fight: "Fight",
  flight: "Flight",
  grit: "Grit",
};

function matchStatusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "Borrador";
    case "live":
      return "En vivo";
    case "paused":
      return "Pausada";
    case "finished":
      return "Finalizada";
    case "archived":
      return "Archivada";
    default:
      return status;
  }
}

/** Listado tipo «jugadores en mesa»: sin el director salvo que sea la misma cuenta y ya eligió hoja (una sola tarjeta). */
function filterMesaSheetRowsForPlayerTable(
  rows: MatchMemberSheetRow[],
  masterUserId: string,
): MatchMemberSheetRow[] {
  return rows.filter((r) => {
    if (r.member_role === "player") return true;
    if (r.member_role === "master" && r.member_user_id === masterUserId && r.character_id) return true;
    return false;
  });
}

export default function MasterHomePage() {
  const supabase = useMemo(() => createSupabaseFromNextPublicEnv(), []);
  const [emailLocal, setEmailLocal] = useState("");
  const [emailDomainChoice, setEmailDomainChoice] = useState<string>(
    LOGIN_EMAIL_DOMAIN_SUFFIXES[0] ?? "@gmail.com",
  );
  const [emailCustomDomain, setEmailCustomDomain] = useState("");
  const [loginUseFullEmail, setLoginUseFullEmail] = useState(false);
  const [fullEmailDirect, setFullEmailDirect] = useState("");
  const [recentEmails, setRecentEmails] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [title, setTitle] = useState("ROLEADA1");
  const [busy, setBusy] = useState(false);
  const [showPostLoginLoader, setShowPostLoginLoader] = useState(false);
  const [postLoginLoaderProgress, setPostLoginLoaderProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [lastMatch, setLastMatch] = useState<ActiveMatchState | null>(null);
  const [matchDescriptionInput, setMatchDescriptionInput] = useState("");
  const [savingMatchDescription, setSavingMatchDescription] = useState(false);
  const [kickingUserId, setKickingUserId] = useState<string | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [memberSheets, setMemberSheets] = useState<MatchMemberSheetRow[]>([]);
  const [memberStatsByCharacterId, setMemberStatsByCharacterId] = useState<Record<string, CharacterStatPreview[]>>({});
  const [blankSheets, setBlankSheets] = useState<MatchMemberSheetRow[]>([]);
  const [blankStatsByCharacterId, setBlankStatsByCharacterId] = useState<Record<string, CharacterStatPreview[]>>({});
  const [assignableChars, setAssignableChars] = useState<PlayerCharacterForMasterRow[]>([]);
  const [checkTargetCharacterIds, setCheckTargetCharacterIds] = useState<string[]>([]);
  const [checkStatKey, setCheckStatKey] = useState<StatKey | null>("brains");
  const [checkImportant, setCheckImportant] = useState(false);
  const [checkTargetScope, setCheckTargetScope] = useState<"single_player" | "multiple_players">("single_player");
  const [checkDc, setCheckDc] = useState("10");
  const [showCheckComposerModal, setShowCheckComposerModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteCharacterId, setInviteCharacterId] = useState("");
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [savedMatches, setSavedMatches] = useState<SavedMatchRow[]>([]);
  const [myMatchesLoading, setMyMatchesLoading] = useState(false);
  const [deletingMatchId, setDeletingMatchId] = useState<string | null>(null);
  const [showNewMatchModal, setShowNewMatchModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showSideMenu, setShowSideMenu] = useState(false);
  /** Referencia rápida de strengths desde el menú lateral (null | lista I | lista II) */
  const [strengthReferenceOpen, setStrengthReferenceOpen] = useState<null | "i" | "ii">(null);
  const [showBlankManagerModal, setShowBlankManagerModal] = useState(false);
  const [pendingInvites, setPendingInvites] = useState<MesaPendingInvite[]>([]);
  const [grantTokensModal, setGrantTokensModal] = useState<{ characterId: string; displayName: string } | null>(null);
  const [grantAmountInput, setGrantAmountInput] = useState("3");
  const [grantingTokens, setGrantingTokens] = useState(false);
  const [checkLogRows, setCheckLogRows] = useState<CheckLogRow[]>([]);
  const [showRollHistoryModal, setShowRollHistoryModal] = useState(false);
  const [rollHistoryRows, setRollHistoryRows] = useState<CheckLogRow[]>([]);
  const [rollHistoryLoading, setRollHistoryLoading] = useState(false);
  const [matchCodeCopied, setMatchCodeCopied] = useState(false);
  const [masterBlankCharacters, setMasterBlankCharacters] = useState<MasterTemplateCharacter[]>([]);
  const [templateCreateKind, setTemplateCreateKind] = useState<"master_npc" | "master_pet">("master_npc");
  const [grantPetCharacterId, setGrantPetCharacterId] = useState("");
  const [grantPetPlayerUserId, setGrantPetPlayerUserId] = useState("");
  const [selectedBlankId, setSelectedBlankId] = useState<string | null>(null);
  const [showBlankEditor, setShowBlankEditor] = useState(false);
  const [blankFormName, setBlankFormName] = useState("");
  const [blankFormAvatarUrl, setBlankFormAvatarUrl] = useState("");
  const [blankFormDice, setBlankFormDice] = useState<Record<StatKey, string>>(EMPTY_BLANK_DICE);
  const [blankFormTraining, setBlankFormTraining] = useState<Record<StatKey, StatTrainingTier>>(EMPTY_BLANK_TRAINING);
  const [blankFormAvatarFile, setBlankFormAvatarFile] = useState<File | null>(null);
  const [blankFormAvatarPreview, setBlankFormAvatarPreview] = useState("");
  const postLoginLoaderMinUntilRef = useRef(0);
  const blankAvatarInputRef = useRef<HTMLInputElement | null>(null);

  const persistActiveMatch = useCallback((m: ActiveMatchState | null) => {
    try {
      if (!m) {
        globalThis.localStorage?.removeItem(MASTER_ACTIVE_MATCH_KEY);
        return;
      }
      globalThis.localStorage?.setItem(MASTER_ACTIVE_MATCH_KEY, JSON.stringify(m));
    } catch {
      /* ignore storage errors */
    }
  }, []);

  useEffect(() => {
    if (!showNewMatchModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowNewMatchModal(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showNewMatchModal]);

  useEffect(() => {
    if (!showInviteModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowInviteModal(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showInviteModal]);

  useEffect(() => {
    if (!showSideMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowSideMenu(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSideMenu]);

  useEffect(() => {
    if (!strengthReferenceOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setStrengthReferenceOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [strengthReferenceOpen]);

  useEffect(() => {
    if (!showBlankManagerModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowBlankManagerModal(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showBlankManagerModal]);

  useEffect(() => {
    if (!grantTokensModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !grantingTokens) setGrantTokensModal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [grantTokensModal, grantingTokens]);

  const loadMyMatches = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) {
      setSavedMatches([]);
      return;
    }
    setMyMatchesLoading(true);
    setErr(null);
    try {
      const { data, error } = await supabase
        .from("matches")
        .select("id, code, title, status, created_at, master_user_id, current_scene_text, chapter_upgrades_open, chapter_index")
        .eq("master_user_id", uid)
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      setSavedMatches((data ?? []) as SavedMatchRow[]);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
      setSavedMatches([]);
    } finally {
      setMyMatchesLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSessionEmail(data.session?.user.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (cancelled) return;
      setSessionEmail(session?.user.email ?? null);
      const uid = session?.user?.id ?? null;
      setLastMatch((prev) => {
        if (!uid) {
          if (prev) persistActiveMatch(null);
          return null;
        }
        if (prev && prev.masterUserId !== uid) {
          persistActiveMatch(null);
          return null;
        }
        return prev;
      });
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [persistActiveMatch, supabase]);

  useEffect(() => {
    try {
      const raw = globalThis.localStorage?.getItem(RECENT_LOGIN_EMAILS_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) {
        setRecentEmails(arr.filter((x): x is string => typeof x === "string").slice(0, 8));
      }
    } catch {
      /* ignore */
    }
  }, []);

  const loadMembers = useCallback(async () => {
    if (!lastMatch) {
      setMembers([]);
      return;
    }
    const { data, error } = await supabase
      .from("match_members")
      .select("user_id, role, profiles(username, display_name)")
      .eq("match_id", lastMatch.id);
    if (error) {
      setErr(error.message);
      return;
    }
    const rows: MemberRow[] = (data ?? []).map((raw) => {
      const r = raw as {
        user_id: string;
        role: string;
        profiles: { username: string; display_name: string } | { username: string; display_name: string }[] | null;
      };
      const p = Array.isArray(r.profiles) ? r.profiles[0] ?? null : r.profiles;
      return { user_id: r.user_id, role: r.role, profiles: p };
    });
    setMembers(rows);
  }, [lastMatch, supabase]);

  const loadMesa = useCallback(async () => {
    if (!lastMatch) {
      setMemberSheets([]);
      setMemberStatsByCharacterId({});
      return;
    }
    try {
      const rows = await rpcListMatchMemberSheetsForMaster(supabase, lastMatch.id);
      let enrichedRows = rows;
      const missingCharacterForMembers = rows
        .filter((r) => !r.character_id && r.member_role !== "blank")
        .map((r) => String(r.member_user_id));
      if (missingCharacterForMembers.length > 0) {
        const { data: assignedRows, error: assignedErr } = await supabase
          .from("match_characters")
          .select("user_id, character_id")
          .eq("match_id", lastMatch.id)
          .eq("is_active", true)
          .in("user_id", missingCharacterForMembers);
        if (assignedErr) throw assignedErr;

        const activeCharacterByUserId: Record<string, string> = {};
        for (const raw of (assignedRows ?? []) as Array<{ user_id: string; character_id: string }>) {
          const uid = String(raw.user_id ?? "").trim();
          const cid = String(raw.character_id ?? "").trim();
          if (!uid || !cid || activeCharacterByUserId[uid]) continue;
          activeCharacterByUserId[uid] = cid;
        }

        const fallbackCharacterIds = Array.from(new Set(Object.values(activeCharacterByUserId)));
        if (fallbackCharacterIds.length > 0) {
          const [{ data: charsData, error: charsErr }, { data: runtimeData, error: runtimeErr }] = await Promise.all([
            supabase
              .from("characters")
              .select("id, name, avatar_url, concept")
              .in("id", fallbackCharacterIds),
            supabase
              .from("character_runtime")
              .select("character_id, current_tokens")
              .eq("match_id", lastMatch.id)
              .in("character_id", fallbackCharacterIds),
          ]);
          if (charsErr) throw charsErr;
          if (runtimeErr) throw runtimeErr;

          const charById = new Map(
            ((charsData ?? []) as Array<{ id: string; name: string | null; avatar_url: string | null; concept: string | null }>).map(
              (raw) => [
                String(raw.id),
                {
                  name: raw.name ? String(raw.name) : null,
                  avatarUrl: raw.avatar_url ? String(raw.avatar_url) : null,
                  concept: raw.concept ? String(raw.concept) : null,
                },
              ],
            ),
          );
          const runtimeTokensByCharacterId = new Map(
            ((runtimeData ?? []) as Array<{ character_id: string; current_tokens: number | null }>).map((raw) => [
              String(raw.character_id),
              Number(raw.current_tokens ?? 0),
            ]),
          );

          enrichedRows = rows.map((r) => {
            if (r.character_id) return r;
            const uid = String(r.member_user_id);
            const fallbackCid = activeCharacterByUserId[uid];
            if (!fallbackCid) return r;
            const info = charById.get(fallbackCid);
            return {
              ...r,
              character_id: fallbackCid,
              character_name: info?.name ?? r.character_name ?? null,
              avatar_url: info?.avatarUrl ?? r.avatar_url ?? null,
              concept: info?.concept ?? r.concept ?? null,
              runtime_tokens: runtimeTokensByCharacterId.get(fallbackCid) ?? r.runtime_tokens ?? null,
            };
          });
        }
      }

      setMemberSheets(enrichedRows);
      const characterIds = enrichedRows
        .map((r) => r.character_id?.trim() ?? "")
        .filter((id): id is string => id.length > 0);
      if (characterIds.length === 0) {
        setMemberStatsByCharacterId({});
      } else {
        const { data: statsData, error: statsErr } = await supabase
          .from("character_stats")
          .select("character_id, stat_key, die_size, stat_label, base_modifier, training_tier")
          .in("character_id", characterIds);
        if (statsErr) throw statsErr;
        const grouped: Record<string, CharacterStatPreview[]> = {};
        for (const cid of characterIds) grouped[cid] = [];
        for (const raw of (statsData ?? []) as Array<{
          character_id: string;
          stat_key: string;
          die_size: string;
          stat_label: string | null;
          base_modifier: number;
          training_tier: string | null;
        }>) {
          const cid = String(raw.character_id);
          const modifier = effectiveStatModifier(Number(raw.base_modifier ?? 0), raw.training_tier);
          (grouped[cid] ??= []).push({
            statKey: raw.stat_key,
            dieSize: String(raw.die_size ?? "20"),
            modifier,
          });
        }
        for (const cid of Object.keys(grouped)) {
          grouped[cid].sort((a, b) => a.statKey.localeCompare(b.statKey));
        }
        setMemberStatsByCharacterId(grouped);
      }
    } catch (e: unknown) {
      setMemberSheets([]);
      setMemberStatsByCharacterId({});
      const base = e instanceof Error ? e.message : String(e);
      setErr(
        `${base} — ¿Migraciones \`20260416120000_match_member_active_character.sql\`, \`20260418100000_active_character_allow_master.sql\` y \`20260419120000_list_match_member_sheets_enriched.sql\`?`,
      );
    }
  }, [lastMatch, supabase]);

  const loadBlanks = useCallback(async () => {
    if (!lastMatch) {
      setBlankSheets([]);
      setBlankStatsByCharacterId({});
      return;
    }
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id ?? null;
      if (!uid) {
        setBlankSheets([]);
        setBlankStatsByCharacterId({});
        return;
      }
      const { data: blankAssignments, error: assignErr } = await supabase
        .from("match_characters")
        .select("character_id")
        .eq("match_id", lastMatch.id)
        .eq("user_id", uid)
        .eq("assigned_by_master_user_id", uid)
        .eq("is_active", true);
      if (assignErr) throw assignErr;

      const assignedIds = Array.from(
        new Set((blankAssignments ?? []).map((r) => String(r.character_id ?? "").trim()).filter(Boolean)),
      );
      let npcMesaIds = assignedIds;
      if (assignedIds.length > 0) {
        const { data: originRows, error: oErr } = await supabase
          .from("characters")
          .select("id, origin")
          .in("id", assignedIds);
        if (oErr) throw oErr;
        const npcOnly = new Set(
          (originRows ?? [])
            .filter((r) => String((r as { origin?: string }).origin ?? "") === "master_npc")
            .map((r) => String(r.id)),
        );
        npcMesaIds = assignedIds.filter((id) => npcOnly.has(id));
      }
      const inUseByPlayers = new Set(
        memberSheets.map((r) => r.character_id?.trim() ?? "").filter((id): id is string => id.length > 0),
      );
      const filteredBlankIds = npcMesaIds.filter((id) => !inUseByPlayers.has(id));
      if (filteredBlankIds.length === 0) {
        setBlankSheets([]);
        setBlankStatsByCharacterId({});
        return;
      }

      const { data: blanks, error: charsErr } = await supabase
        .from("characters")
        .select("id, name, avatar_url, origin")
        .in("id", filteredBlankIds)
        .order("name", { ascending: true });
      if (charsErr) throw charsErr;

      let runtimeByCharacterId: Record<string, number> = {};
      if (filteredBlankIds.length > 0) {
        const { data: runtimeRows, error: runtimeErr } = await supabase
          .from("character_runtime")
          .select("character_id, current_tokens")
          .eq("match_id", lastMatch.id)
          .in("character_id", filteredBlankIds);
        if (runtimeErr) throw runtimeErr;
        runtimeByCharacterId = Object.fromEntries(
          (runtimeRows ?? []).map((r) => [String(r.character_id), Number(r.current_tokens ?? 0)]),
        );
      }

      const rows: MatchMemberSheetRow[] = (blanks ?? []).map((raw) => {
        const r = raw as { id: string; name: string | null; avatar_url?: string | null; origin?: string };
        const cid = String(r.id);
        const name = String(r.name ?? "NPC").trim() || "NPC";
        return {
          member_user_id: `blank:${cid}`,
          member_role: "blank",
          character_id: cid,
          character_name: name,
          owner_display: "Master",
          avatar_url: r.avatar_url ? String(r.avatar_url) : null,
          concept: null,
          connection_status: "offline",
          last_seen_at: null,
          runtime_tokens: runtimeByCharacterId[cid] ?? 0,
          character_origin: (r.origin as string | undefined) ?? "master_npc",
        };
      });
      setBlankSheets(rows);

      if (filteredBlankIds.length === 0) {
        setBlankStatsByCharacterId({});
      } else {
        const { data: statsData, error: statsErr } = await supabase
          .from("character_stats")
          .select("character_id, stat_key, die_size, base_modifier, training_tier")
          .in("character_id", filteredBlankIds);
        if (statsErr) throw statsErr;
        const grouped: Record<string, CharacterStatPreview[]> = {};
        for (const cid of filteredBlankIds) grouped[cid] = [];
        for (const raw of (statsData ?? []) as Array<{
          character_id: string;
          stat_key: string;
          die_size: string;
          base_modifier: number;
          training_tier: string | null;
        }>) {
          const cid = String(raw.character_id);
          const modifier = effectiveStatModifier(Number(raw.base_modifier ?? 0), raw.training_tier);
          (grouped[cid] ??= []).push({
            statKey: raw.stat_key,
            dieSize: String(raw.die_size ?? "20"),
            modifier,
          });
        }
        for (const cid of Object.keys(grouped)) grouped[cid].sort((a, b) => a.statKey.localeCompare(b.statKey));
        setBlankStatsByCharacterId(grouped);
      }
    } catch {
      setBlankSheets([]);
      setBlankStatsByCharacterId({});
    }
  }, [lastMatch, memberSheets, supabase]);

  const loadPendingInvites = useCallback(async () => {
    if (!lastMatch) {
      setPendingInvites([]);
      return;
    }
    const { data, error } = await supabase
      .from("match_invites")
      .select(
        "id, created_at, invited_user_id, invitee:profiles!match_invites_invited_user_id_fkey(username, display_name)",
      )
      .eq("match_id", lastMatch.id)
      .eq("status", "pending");
    if (error) {
      const { data: d2, error: e2 } = await supabase
        .from("match_invites")
        .select("id, created_at, invited_user_id")
        .eq("match_id", lastMatch.id)
        .eq("status", "pending");
      if (e2) {
        setPendingInvites([]);
        return;
      }
      setPendingInvites(
        (d2 ?? []).map((r: { id: string; created_at: string; invited_user_id: string }) => ({
          id: r.id,
          createdAt: r.created_at,
          displayLabel: `Jugador ${r.invited_user_id.slice(0, 8)}…`,
        })),
      );
      return;
    }
    const rows = (data ?? []) as Array<{
      id: string;
      created_at: string;
      invited_user_id: string;
      invitee?: { username?: string; display_name?: string } | { username?: string; display_name?: string }[] | null;
    }>;
    setPendingInvites(
      rows.map((r) => {
        const raw = r.invitee;
        const p = Array.isArray(raw) ? raw[0] : raw;
        const uid = String(r.invited_user_id);
        const label =
          p?.display_name?.trim() || p?.username?.trim() || `Jugador ${uid.slice(0, 8)}…`;
        return {
          id: String(r.id),
          createdAt: String(r.created_at),
          displayLabel: label,
        };
      }),
    );
  }, [lastMatch, supabase]);

  const loadMasterBlankCharacters = useCallback(async () => {
    if (!lastMatch) {
      setMasterBlankCharacters([]);
      return;
    }
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) {
      setMasterBlankCharacters([]);
      return;
    }
    const { data: allChars, error: charsErr } = await supabase
      .from("characters")
      .select("id, name, avatar_url, origin")
      .eq("owner_user_id", uid)
      .in("origin", ["master_npc", "master_pet"])
      .order("name", { ascending: true });
    if (charsErr) {
      setMasterBlankCharacters([]);
      return;
    }
    const chars = allChars ?? [];
    if (chars.length === 0) {
      setMasterBlankCharacters([]);
      return;
    }
    const { data: assignedRows, error: assignedErr } = await supabase
      .from("match_characters")
      .select("character_id, user_id")
      .eq("match_id", lastMatch.id)
      .eq("is_active", true);
    if (assignedErr) {
      setMasterBlankCharacters([]);
      return;
    }
    const masterAssignments = new Set(
      (assignedRows ?? []).filter((r) => String(r.user_id) === uid).map((r) => String(r.character_id)),
    );
    const petGrantUserIds = (assignedRows ?? [])
      .filter((r) => String(r.user_id) !== uid)
      .map((r) => ({ cid: String(r.character_id), userId: String(r.user_id) }));
    const grantedProfileIds = Array.from(new Set(petGrantUserIds.map((x) => x.userId)));
    const profileByUserId = new Map<string, string>();
    if (grantedProfileIds.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, username, display_name")
        .in("id", grantedProfileIds);
      for (const p of profs ?? []) {
        const pr = p as { id: string; username?: string; display_name?: string };
        profileByUserId.set(
          pr.id,
          pr.display_name?.trim() || pr.username?.trim() || `Jugador ${pr.id.slice(0, 8)}…`,
        );
      }
    }
    const grantLabelByPet = new Map<string, string>();
    for (const row of petGrantUserIds) {
      const tmpl = chars.find((c) => String(c.id) === row.cid) as { origin?: string } | undefined;
      if (tmpl && String(tmpl.origin ?? "") === "master_pet") {
        grantLabelByPet.set(row.cid, profileByUserId.get(row.userId) ?? row.userId.slice(0, 8));
      }
    }
    const rows: MasterTemplateCharacter[] = chars.map((r) => {
      const ro = r as {
        id: string;
        name: string | null;
        avatar_url?: string | null;
        origin?: string;
      };
      const oid = String(ro.origin ?? "");
      const origin = oid === "master_pet" ? "master_pet" : "master_npc";
      return {
        id: String(ro.id),
        name: String(ro.name ?? "Plantilla").trim() || "Plantilla",
        avatarUrl: ro.avatar_url ? String(ro.avatar_url) : null,
        inMesa: origin === "master_npc" ? masterAssignments.has(String(ro.id)) : false,
        origin,
        grantedToLabel: origin === "master_pet" ? (grantLabelByPet.get(String(ro.id)) ?? null) : null,
      };
    });
    setMasterBlankCharacters(rows);
  }, [lastMatch, supabase]);

  useEffect(() => {
    if (!showBlankManagerModal) return;
    if (!selectedBlankId) {
      setBlankFormName("");
      setBlankFormAvatarUrl("");
      setBlankFormDice(EMPTY_BLANK_DICE);
      setBlankFormTraining(EMPTY_BLANK_TRAINING);
      setBlankFormAvatarFile(null);
      setBlankFormAvatarPreview("");
      return;
    }
    const selected = masterBlankCharacters.find((c) => c.id === selectedBlankId);
    if (!selected) {
      setSelectedBlankId(null);
      setBlankFormName("");
      setBlankFormAvatarUrl("");
      setBlankFormDice(EMPTY_BLANK_DICE);
      setBlankFormTraining(EMPTY_BLANK_TRAINING);
      setBlankFormAvatarFile(null);
      setBlankFormAvatarPreview("");
      return;
    }
    setBlankFormName(selected.name);
    setBlankFormAvatarUrl(selected.avatarUrl ?? "");
    setBlankFormAvatarFile(null);
    setBlankFormAvatarPreview("");
    void (async () => {
      const { data, error } = await supabase
        .from("character_stats")
        .select("stat_key, die_size, base_modifier, training_tier")
        .eq("character_id", selected.id);
      if (error) {
        setBlankFormDice(EMPTY_BLANK_DICE);
        setBlankFormTraining(EMPTY_BLANK_TRAINING);
        return;
      }
      const nextDice: Record<StatKey, string> = { ...EMPTY_BLANK_DICE };
      const nextTraining: Record<StatKey, StatTrainingTier> = { ...EMPTY_BLANK_TRAINING };
      for (const raw of (data ?? []) as Array<{ stat_key: string; die_size: string; base_modifier: number; training_tier: string | null }>) {
        const k = raw.stat_key as StatKey;
        if (STAT_KEYS.includes(k)) {
          nextDice[k] = String(raw.die_size ?? "20");
          const t = raw.training_tier;
          nextTraining[k] = t === "trained_in" || t === "studied_in" || t === "master_in" ? t : "none";
        }
      }
      setBlankFormDice(nextDice);
      setBlankFormTraining(nextTraining);
    })();
  }, [masterBlankCharacters, selectedBlankId, showBlankManagerModal, supabase]);

  const onPickBlankAvatar = useCallback(() => {
    blankAvatarInputRef.current?.click();
  }, []);

  const onBlankAvatarFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setBlankFormAvatarFile(file);
    if (!file) {
      setBlankFormAvatarPreview("");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setBlankFormAvatarPreview(typeof reader.result === "string" ? reader.result : "");
    reader.readAsDataURL(file);
  }, []);

  const bumpBlankDie = useCallback((key: StatKey, delta: number) => {
    setBlankFormDice((prev) => {
      const cur = prev[key];
      const i = BLANK_DICE_OPTIONS.indexOf(cur as (typeof BLANK_DICE_OPTIONS)[number]);
      const idx = (Math.max(0, i) + delta + BLANK_DICE_OPTIONS.length) % BLANK_DICE_OPTIONS.length;
      return { ...prev, [key]: BLANK_DICE_OPTIONS[idx] };
    });
  }, []);

  const saveBlankCharacter = useCallback(async () => {
    if (!lastMatch) return;
    const name = blankFormName.trim();
    if (!name) {
      setErr("El nombre del personaje es obligatorio.");
      return;
    }
    setErr(null);
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) {
      setErr("Sin sesión de master.");
      return;
    }
    let avatarUrl: string | null = blankFormAvatarUrl.trim() || null;
    if (selectedBlankId) {
      if (blankFormAvatarFile) {
        const path = `${uid}/${selectedBlankId}.jpg`;
        const { error: upErr } = await supabase.storage.from(BLANK_AVATAR_BUCKET).upload(path, blankFormAvatarFile, {
          upsert: true,
          contentType: blankFormAvatarFile.type || "image/jpeg",
        });
        if (upErr) {
          setErr(upErr.message);
          return;
        }
        avatarUrl = supabase.storage.from(BLANK_AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
      }
      const { error } = await supabase
        .from("characters")
        .update({
          name,
          avatar_url: avatarUrl,
        })
        .eq("id", selectedBlankId);
      if (error) {
        setErr(error.message);
        return;
      }
      const statRows = STAT_KEYS.map((k) => {
        return {
          character_id: selectedBlankId,
          stat_key: k,
          stat_label: mapVisibleStatLabel(k, null),
          die_size: blankFormDice[k] ?? "20",
          base_modifier: 0,
          training_tier: blankFormTraining[k] ?? "none",
        };
      });
      const { error: eStats } = await supabase.from("character_stats").upsert(statRows, {
        onConflict: "character_id,stat_key",
      });
      if (eStats) {
        setErr(eStats.message);
        return;
      }
      const tmplOrigin =
        masterBlankCharacters.find((c) => c.id === selectedBlankId)?.origin ?? "master_npc";
      const tmplNotes = tmplOrigin === "master_pet" ? MASTER_PET_NOTE : MASTER_NPC_NOTE;
      const { error: eRes } = await supabase.from("character_resources").upsert(
        {
          character_id: selectedBlankId,
          notes: tmplNotes,
        },
        { onConflict: "character_id" },
      );
      if (eRes) {
        setErr(eRes.message);
        return;
      }
    } else {
      const { data: created, error } = await supabase
        .from("characters")
        .insert({
          owner_user_id: uid,
          name,
          avatar_url: avatarUrl,
          origin: templateCreateKind,
        })
        .select("id")
        .single();
      if (error) {
        setErr(error.message);
        return;
      }
      if (!created?.id) {
        setErr("No se pudo crear el personaje.");
        return;
      }
      if (blankFormAvatarFile) {
        const path = `${uid}/${String(created.id)}.jpg`;
        const { error: upErr } = await supabase.storage.from(BLANK_AVATAR_BUCKET).upload(path, blankFormAvatarFile, {
          upsert: true,
          contentType: blankFormAvatarFile.type || "image/jpeg",
        });
        if (upErr) {
          setErr(upErr.message);
          return;
        }
        avatarUrl = supabase.storage.from(BLANK_AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
        const { error: eu } = await supabase.from("characters").update({ avatar_url: avatarUrl }).eq("id", created.id);
        if (eu) {
          setErr(eu.message);
          return;
        }
      }
      const statRows = STAT_KEYS.map((k) => {
        return {
          character_id: String(created.id),
          stat_key: k,
          stat_label: mapVisibleStatLabel(k, null),
          die_size: blankFormDice[k] ?? "20",
          base_modifier: 0,
          training_tier: blankFormTraining[k] ?? "none",
        };
      });
      const { error: eStats } = await supabase.from("character_stats").insert(statRows);
      if (eStats) {
        setErr(eStats.message);
        return;
      }
      const tmplNotesCreate = templateCreateKind === "master_pet" ? MASTER_PET_NOTE : MASTER_NPC_NOTE;
      const { error: eRes } = await supabase.from("character_resources").insert({
        character_id: String(created.id),
        notes: tmplNotesCreate,
      });
      if (eRes) {
        setErr(eRes.message);
        return;
      }
    }
    setSelectedBlankId(null);
    setShowBlankEditor(false);
    setBlankFormName("");
    setBlankFormAvatarUrl("");
    setBlankFormDice(EMPTY_BLANK_DICE);
    setBlankFormTraining(EMPTY_BLANK_TRAINING);
    setBlankFormAvatarFile(null);
    setBlankFormAvatarPreview("");
    await Promise.all([loadMasterBlankCharacters(), loadBlanks(), loadMesa()]);
  }, [
    blankFormAvatarFile,
    blankFormAvatarUrl,
    blankFormDice,
    blankFormTraining,
    blankFormName,
    lastMatch,
    loadBlanks,
    loadMasterBlankCharacters,
    loadMesa,
    masterBlankCharacters,
    selectedBlankId,
    supabase,
    templateCreateKind,
  ]);

  const deleteBlankCharacter = useCallback(
    async (blankId: string) => {
      if (!window.confirm("¿Eliminar este NPC/PET plantilla?")) return;
      setErr(null);
      const { error } = await supabase.from("characters").delete().eq("id", blankId);
      if (error) {
        setErr(error.message);
        return;
      }
      if (selectedBlankId === blankId) {
        setSelectedBlankId(null);
        setBlankFormName("");
        setBlankFormAvatarUrl("");
        setBlankFormDice(EMPTY_BLANK_DICE);
        setBlankFormTraining(EMPTY_BLANK_TRAINING);
        setBlankFormAvatarFile(null);
        setBlankFormAvatarPreview("");
      }
      await Promise.all([loadMasterBlankCharacters(), loadBlanks(), loadMesa()]);
    },
    [loadBlanks, loadMasterBlankCharacters, loadMesa, selectedBlankId, supabase],
  );

  const addBlankToMesa = useCallback(
    async (blankId: string) => {
      if (!lastMatch) return;
      setErr(null);
      const tmpl = masterBlankCharacters.find((c) => c.id === blankId);
      if (tmpl?.origin === "master_pet") {
        setErr("Los PET no van a tu fila del director: cedélos a un jugador desde el gestor.");
        return;
      }
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) {
        setErr("Sin sesión de master.");
        return;
      }
      const { error: eAssign } = await supabase.from("match_characters").upsert(
        {
          match_id: lastMatch.id,
          user_id: uid,
          character_id: blankId,
          is_active: true,
          assigned_by_master_user_id: uid,
        },
        { onConflict: "match_id,user_id,character_id" },
      );
      if (eAssign) {
        setErr(eAssign.message);
        return;
      }
      const { error: eRuntime } = await supabase.from("character_runtime").insert({
        match_id: lastMatch.id,
        character_id: blankId,
        current_tokens: 5,
        current_modifier: 0,
        check_status: "idle",
        last_result: "none",
      });
      if (eRuntime && eRuntime.code !== "23505") {
        setErr(eRuntime.message);
        return;
      }
      await Promise.all([loadMasterBlankCharacters(), loadBlanks(), loadMesa()]);
    },
    [lastMatch, loadBlanks, loadMasterBlankCharacters, loadMesa, masterBlankCharacters, supabase],
  );

  const queryCheckResponses = useCallback(
    async (limit: number): Promise<CheckLogRow[]> => {
      if (!lastMatch) return [];
      const { data: checkRows, error: checksErr } = await supabase
        .from("checks")
        .select("id")
        .eq("match_id", lastMatch.id)
        .order("created_at", { ascending: false })
        .limit(4000);
      if (checksErr) return [];
      const checkIds = (checkRows ?? []).map((r) => String(r.id)).filter(Boolean);
      if (checkIds.length === 0) return [];
      const { data, error } = await supabase
        .from("check_responses")
        .select(
          "id, submitted_at, chapter_index, character_id, die_size_at_time, roll_value, stat_key, tokens_spent, modifier_applied, computed_total, target_value, outcome, margin, explosion_flag, explosion_steps, user_comment, check:checks(check_value, stat_label_at_time, prompt_text, instructions_text, important), character:characters(name)",
        )
        .in("check_id", checkIds)
        .order("submitted_at", { ascending: false })
        .limit(limit);
      if (error) return [];
      return (data ?? []) as CheckLogRow[];
    },
    [lastMatch, supabase],
  );

  const loadCheckLogPreview = useCallback(async () => {
    setCheckLogRows(await queryCheckResponses(4));
  }, [queryCheckResponses]);

  const loadRollHistoryModal = useCallback(async () => {
    setRollHistoryLoading(true);
    setRollHistoryRows([]);
    try {
      setRollHistoryRows(await queryCheckResponses(2000));
    } finally {
      setRollHistoryLoading(false);
    }
  }, [queryCheckResponses]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    void loadMesa();
  }, [loadMesa]);

  useEffect(() => {
    void loadPendingInvites();
  }, [loadPendingInvites]);

  useEffect(() => {
    void loadBlanks();
  }, [loadBlanks]);

  useEffect(() => {
    void loadCheckLogPreview();
  }, [loadCheckLogPreview]);

  useEffect(() => {
    if (!showBlankManagerModal) return;
    void loadMasterBlankCharacters();
  }, [loadMasterBlankCharacters, showBlankManagerModal]);

  const mesaDisplayRows = useMemo(() => {
    if (!lastMatch) return [];
    return filterMesaSheetRowsForPlayerTable(memberSheets, lastMatch.masterUserId);
  }, [lastMatch, memberSheets]);

  const combinedDisplayRows = useMemo(() => [...mesaDisplayRows, ...blankSheets], [blankSheets, mesaDisplayRows]);

  useEffect(() => {
    setCheckTargetCharacterIds((prev) =>
      prev.filter((id) => combinedDisplayRows.some((r) => (r.character_id?.trim() ?? "") === id)),
    );
  }, [combinedDisplayRows]);

  const toggleCheckTarget = useCallback((characterId: string) => {
    setCheckTargetCharacterIds((prev) => {
      if (checkTargetScope === "single_player") {
        return prev.includes(characterId) ? [] : [characterId];
      }
      return prev.includes(characterId) ? prev.filter((x) => x !== characterId) : [...prev, characterId];
    });
  }, [checkTargetScope]);

  const adjustCharacterTokens = useCallback(
    async (characterId: string, displayName: string, delta: number) => {
      if (!lastMatch || delta === 0) return;
      setErr(null);
      setInfoMsg(null);
      try {
        const res = await rpcMasterGrantCharacterTokens(supabase, {
          matchId: lastMatch.id,
          characterId,
          amount: delta,
        });
        const verb = delta > 0 ? "sumó" : "restó";
        setInfoMsg(`${verb} ${Math.abs(delta)} ficha(s) a «${displayName}». Total en mesa: ${res.current_tokens}.`);
        await Promise.all([loadMesa(), loadBlanks()]);
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [lastMatch, loadBlanks, loadMesa, supabase],
  );

  const submitGrantTokens = useCallback(async () => {
    if (!lastMatch || !grantTokensModal) return;
    const n = Number.parseInt(grantAmountInput.trim(), 10);
    if (!Number.isFinite(n) || n < 1 || n > 500) {
      setErr("Cantidad de fichas: un entero entre 1 y 500.");
      return;
    }
    setErr(null);
    setInfoMsg(null);
    setGrantingTokens(true);
    try {
      const res = await rpcMasterGrantCharacterTokens(supabase, {
        matchId: lastMatch.id,
        characterId: grantTokensModal.characterId,
        amount: n,
      });
      setInfoMsg(
        `+${res.granted} fichas a «${grantTokensModal.displayName}». Total en mesa: ${res.current_tokens}.`,
      );
      setGrantTokensModal(null);
      await loadMesa();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setGrantingTokens(false);
    }
  }, [grantAmountInput, grantTokensModal, lastMatch, loadMesa, supabase]);

  const loadAssignableChars = useCallback(async () => {
    if (!lastMatch) {
      setAssignableChars([]);
      setCheckTargetCharacterIds([]);
      return;
    }
    setErr(null);
    try {
      const rows: PlayerCharacterForMasterRow[] = await rpcListPlayerCharactersForMaster(
        supabase,
        lastMatch.id,
      );
      setAssignableChars(rows);
    } catch (e: unknown) {
      const base = e instanceof Error ? e.message : String(e);
      setErr(
        `${base} — ¿Migraciones \`20260415100000_rpc_list_player_characters_for_master.sql\`, \`20260416120000_match_member_active_character.sql\` y \`20260501180000_character_origin_npc_pet.sql\`?`,
      );
    }
  }, [lastMatch, supabase]);

  const grantPetToPlayer = useCallback(async () => {
    if (!lastMatch) return;
    const petId = grantPetCharacterId.trim();
    const playerUid = grantPetPlayerUserId.trim();
    const petMeta = masterBlankCharacters.find((c) => c.id === petId);
    if (!petId || !playerUid) {
      setErr("Elegí un PET y un jugador.");
      return;
    }
    if (!petMeta || petMeta.origin !== "master_pet") {
      setErr("Solo los personajes tipo PET pueden cederse así.");
      return;
    }
    if (!memberSheets.some((m) => m.member_role === "player" && m.member_user_id === playerUid)) {
      setErr("Elegí un jugador que ya esté en la mesa.");
      return;
    }
    setErr(null);
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) {
      setErr("Sin sesión de master.");
      return;
    }
    const { error: eAssign } = await supabase.from("match_characters").upsert(
      {
        match_id: lastMatch.id,
        user_id: playerUid,
        character_id: petId,
        is_active: true,
        assigned_by_master_user_id: uid,
      },
      { onConflict: "match_id,user_id,character_id" },
    );
    if (eAssign) {
      setErr(eAssign.message);
      return;
    }
    const { error: eRuntime } = await supabase.from("character_runtime").insert({
      match_id: lastMatch.id,
      character_id: petId,
      current_tokens: 5,
      current_modifier: 0,
      check_status: "idle",
      last_result: "none",
    });
    if (eRuntime && eRuntime.code !== "23505") {
      setErr(eRuntime.message);
      return;
    }
    setGrantPetCharacterId("");
    setGrantPetPlayerUserId("");
    await Promise.all([loadMasterBlankCharacters(), loadBlanks(), loadMesa(), loadAssignableChars()]);
  }, [
    grantPetCharacterId,
    grantPetPlayerUserId,
    lastMatch,
    loadAssignableChars,
    loadBlanks,
    loadMasterBlankCharacters,
    loadMesa,
    masterBlankCharacters,
    memberSheets,
    supabase,
  ]);

  const kickMemberFromMatch = useCallback(
    async (memberUserId: string) => {
      if (!lastMatch) return;
      if (memberUserId === lastMatch.masterUserId) return;
      const label =
        memberSheets.find((m) => m.member_user_id === memberUserId)?.owner_display?.trim() || memberUserId;
      if (!window.confirm(`¿Sacar a «${label}» de la partida? Perderá acceso a esta mesa.`)) return;
      setErr(null);
      setInfoMsg(null);
      setKickingUserId(memberUserId);
      try {
        await rpcKickMemberFromMatch(supabase, { matchId: lastMatch.id, memberUserId });
        setInfoMsg("Jugador sacado de la mesa.");
        await loadMembers();
        await loadMesa();
        await loadPendingInvites();
        await loadAssignableChars();
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setKickingUserId(null);
      }
    },
    [lastMatch, loadAssignableChars, loadMembers, loadMesa, loadPendingInvites, memberSheets, supabase],
  );

  useEffect(() => {
    void loadAssignableChars();
  }, [loadAssignableChars]);

  useEffect(() => {
    if (!lastMatch) return;
    const t = window.setInterval(() => {
      void loadMembers();
      void loadMesa();
      void loadBlanks();
      void loadPendingInvites();
      void loadAssignableChars();
      void loadCheckLogPreview();
    }, MESA_AUTO_REFRESH_MS);
    return () => window.clearInterval(t);
  }, [lastMatch, loadAssignableChars, loadBlanks, loadCheckLogPreview, loadMembers, loadMesa, loadPendingInvites]);

  useEffect(() => {
    if (!sessionEmail || lastMatch) return;
    let cancelled = false;
    void (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id ?? null;
      if (cancelled || !uid) return;
      try {
        const raw = globalThis.localStorage?.getItem(MASTER_ACTIVE_MATCH_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as Partial<ActiveMatchState>;
        if (!parsed.id || !parsed.code || !parsed.title || !parsed.masterUserId) return;
        if (String(parsed.masterUserId) !== uid) {
          globalThis.localStorage?.removeItem(MASTER_ACTIVE_MATCH_KEY);
          return;
        }
        if (cancelled) return;
        setLastMatch({
          id: String(parsed.id),
          code: String(parsed.code),
          title: String(parsed.title),
          masterUserId: String(parsed.masterUserId),
          currentSceneText:
            typeof parsed.currentSceneText === "string" || parsed.currentSceneText === null
              ? parsed.currentSceneText
              : null,
          status: typeof parsed.status === "string" ? parsed.status : "draft",
          chapterUpgradesOpen: Boolean(parsed.chapterUpgradesOpen),
          chapterIndex:
            typeof parsed.chapterIndex === "number" && Number.isFinite(parsed.chapterIndex) && parsed.chapterIndex >= 1
              ? Math.floor(parsed.chapterIndex)
              : 1,
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lastMatch, sessionEmail, supabase]);

  useEffect(() => {
    if (!sessionEmail || lastMatch) return;
    void loadMyMatches();
  }, [sessionEmail, lastMatch, loadMyMatches]);

  useEffect(() => {
    if (!showPostLoginLoader) return;
    const timer = window.setInterval(() => {
      setPostLoginLoaderProgress((prev) => {
        const done = Boolean(sessionEmail) && !myMatchesLoading;
        const cap = done ? 1 : 0.92;
        if (prev >= cap) return prev;
        const step = done ? 0.12 : 0.025 + Math.random() * 0.045;
        return Math.min(cap, prev + step);
      });
    }, 90);
    return () => window.clearInterval(timer);
  }, [myMatchesLoading, sessionEmail, showPostLoginLoader]);

  useEffect(() => {
    if (!showPostLoginLoader) return;
    if (postLoginLoaderProgress < 1) return;
    const remaining = Math.max(0, postLoginLoaderMinUntilRef.current - Date.now());
    const timer = window.setTimeout(() => {
      setShowPostLoginLoader(false);
    }, remaining + 180);
    return () => window.clearTimeout(timer);
  }, [postLoginLoaderProgress, showPostLoginLoader]);

  const openSavedMatch = useCallback((row: SavedMatchRow) => {
    setErr(null);
    setInfoMsg(null);
    setCheckTargetCharacterIds([]);
    const next: ActiveMatchState = {
      id: row.id,
      code: row.code,
      title: row.title,
      masterUserId: String(row.master_user_id),
      currentSceneText: row.current_scene_text ?? null,
      status: row.status,
      chapterUpgradesOpen: Boolean(row.chapter_upgrades_open),
      chapterIndex:
        typeof row.chapter_index === "number" && Number.isFinite(row.chapter_index) && row.chapter_index >= 1
          ? Math.floor(row.chapter_index)
          : 1,
    };
    setLastMatch(next);
    setMatchDescriptionInput(row.current_scene_text ?? "");
    persistActiveMatch(next);
  }, [persistActiveMatch]);

  const flushMatchDescription = useCallback(async () => {
    if (!lastMatch) return;
    const text = matchDescriptionInput.trim();
    const prev = (lastMatch.currentSceneText ?? "").trim();
    if (text === prev) return;
    setSavingMatchDescription(true);
    setErr(null);
    try {
      const { error } = await supabase
        .from("matches")
        .update({ current_scene_text: text || null })
        .eq("id", lastMatch.id);
      if (error) throw error;
      const next: ActiveMatchState = {
        ...lastMatch,
        currentSceneText: text || null,
      };
      setLastMatch(next);
      persistActiveMatch(next);
      setInfoMsg("Descripción guardada.");
      window.setTimeout(() => setInfoMsg(null), 2000);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingMatchDescription(false);
    }
  }, [lastMatch, matchDescriptionInput, persistActiveMatch, supabase]);

  const endChapter = useCallback(async () => {
    if (!lastMatch) return;
    setErr(null);
    setBusy(true);
    try {
      const text = matchDescriptionInput.trim();
      const nextChapterIndex = lastMatch.chapterIndex + 1;
      const { error } = await supabase
        .from("matches")
        .update({
          current_scene_text: text || null,
          chapter_index: nextChapterIndex,
        })
        .eq("id", lastMatch.id);
      if (error) throw error;
      const next: ActiveMatchState = {
        ...lastMatch,
        currentSceneText: text || null,
        chapterIndex: nextChapterIndex,
      };
      setLastMatch(next);
      persistActiveMatch(next);
      setInfoMsg(
        `Capítulo ${lastMatch.chapterIndex} guardado. El capítulo activo pasó a ser el ${nextChapterIndex}. Activá el interruptor de mejoras si querés que los jugadores puedan subir TI/SI/MI.`,
      );
      await loadMyMatches();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [lastMatch, loadMyMatches, matchDescriptionInput, persistActiveMatch, supabase]);

  /** Único control en servidor: `chapter_upgrades_open`. Los jugadores solo pueden comprar mejoras con el interruptor activado. */
  const setChapterUpgradesEnabled = useCallback(
    async (enabled: boolean) => {
      if (!lastMatch) return;
      setErr(null);
      setBusy(true);
      try {
        if (enabled) {
          const { error } = await supabase.from("matches").update({ chapter_upgrades_open: true }).eq("id", lastMatch.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.rpc("close_chapter_upgrades_and_burn_leftover_tokens", {
            p_match_id: lastMatch.id,
          });
          if (error) throw error;
        }
        const next: ActiveMatchState = {
          ...lastMatch,
          chapterUpgradesOpen: enabled,
        };
        setLastMatch(next);
        persistActiveMatch(next);
        if (enabled) {
          setInfoMsg(
            "Mejoras activadas: los jugadores pueden comprar TI/SI/MI en la mesa mientras el interruptor siga encendido.",
          );
        } else {
          setInfoMsg(null);
        }
        await loadMyMatches();
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [lastMatch, loadMyMatches, persistActiveMatch, supabase],
  );

  /** Sincroniza descripción desde la BD al cambiar de partida (p. ej. tras hidratar desde localStorage). */
  useEffect(() => {
    if (!lastMatch?.id) {
      setMatchDescriptionInput("");
      return;
    }
    let cancelled = false;
    const id = lastMatch.id;
    void (async () => {
      const { data, error } = await supabase
        .from("matches")
        .select("current_scene_text, status, chapter_upgrades_open, chapter_index")
        .eq("id", id)
        .single();
      if (cancelled || error) return;
      const t = data?.current_scene_text ?? null;
      const ch =
        typeof data?.chapter_index === "number" && Number.isFinite(data.chapter_index) && data.chapter_index >= 1
          ? Math.floor(data.chapter_index)
          : 1;
      setMatchDescriptionInput(t ?? "");
      setLastMatch((prev) =>
        prev && prev.id === id
          ? {
              ...prev,
              currentSceneText: t,
              status: String(data?.status ?? prev.status),
              chapterUpgradesOpen: Boolean(data?.chapter_upgrades_open),
              chapterIndex: ch,
            }
          : prev,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [lastMatch?.id, supabase]);

  const deleteSavedMatch = useCallback(
    async (row: SavedMatchRow) => {
      if (
        !window.confirm(
          `¿Eliminar la partida «${row.title}» (código ${row.code})?\n\nSe borra la mesa en el servidor (jugadores, invitaciones, checks de esa partida). Las hojas en la biblioteca de cada jugador no se eliminan.`,
        )
      ) {
        return;
      }
      setErr(null);
      setInfoMsg(null);
      setDeletingMatchId(row.id);
      try {
        const { error } = await supabase.from("matches").delete().eq("id", row.id);
        if (error) throw error;
        if (lastMatch?.id === row.id) {
          setLastMatch(null);
          persistActiveMatch(null);
          setMatchDescriptionInput("");
          setMembers([]);
          setMemberSheets([]);
          setAssignableChars([]);
          setCheckTargetCharacterIds([]);
          setInviteEmail("");
          setInviteCharacterId("");
        }
        setInfoMsg("Partida eliminada.");
        await loadMyMatches();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setErr(
          `${msg} — Si ves permisos denegados, en Supabase → SQL Editor ejecutá el archivo \`20260419200000_matches_delete_master.sql\`.`,
        );
      } finally {
        setDeletingMatchId(null);
      }
    },
    [lastMatch, loadMyMatches, persistActiveMatch, supabase],
  );

  const signIn = useCallback(async () => {
    const resolved = loginUseFullEmail
      ? fullEmailDirect.trim()
      : buildLoginEmail({
          localPart: emailLocal,
          domainChoice: emailDomainChoice,
          customDomain: emailCustomDomain,
        });
    if (!resolved || !resolved.includes("@")) {
      setErr("Completá un email válido (nombre + dominio o modo completo).");
      return;
    }
    if (emailDomainChoice === LOGIN_EMAIL_CUSTOM && !loginUseFullEmail && !emailCustomDomain.trim()) {
      setErr('Escribí el dominio (ej. empresa.com) o elegí otro proveedor.');
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: resolved, password });
      if (error) throw error;
      postLoginLoaderMinUntilRef.current = Date.now() + 1400;
      setPostLoginLoaderProgress(0.06);
      setShowPostLoginLoader(true);
      setRecentEmails((prev) => {
        const next = pushRecentLoginEmail(prev, resolved);
        try {
          globalThis.localStorage?.setItem(RECENT_LOGIN_EMAILS_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [
    emailCustomDomain,
    emailDomainChoice,
    emailLocal,
    fullEmailDirect,
    loginUseFullEmail,
    password,
    supabase,
  ]);

  const signOut = useCallback(async () => {
    setErr(null);
    setInfoMsg(null);
    setBusy(true);
    try {
      const mid = lastMatch?.id?.trim();
      if (mid) {
        try {
          await rpcLeaveMatchPresence(supabase, { matchId: mid });
        } catch {
          /* sin RPC o sin red: igual cerramos sesión */
        }
      }
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setLastMatch(null);
      persistActiveMatch(null);
      setMatchDescriptionInput("");
      setMembers([]);
      setMemberSheets([]);
      setBlankSheets([]);
      setBlankStatsByCharacterId({});
      setAssignableChars([]);
      setCheckTargetCharacterIds([]);
      setInviteEmail("");
      setInviteCharacterId("");
      setSavedMatches([]);
      setShowNewMatchModal(false);
      setShowInviteModal(false);
      setShowBlankManagerModal(false);
      setShowBlankEditor(false);
      setPendingInvites([]);
      setMasterBlankCharacters([]);
      setSelectedBlankId(null);
      setBlankFormName("");
      setBlankFormAvatarUrl("");
      setBlankFormDice(EMPTY_BLANK_DICE);
      setBlankFormTraining(EMPTY_BLANK_TRAINING);
      setBlankFormAvatarFile(null);
      setBlankFormAvatarPreview("");
      setShowPostLoginLoader(false);
      setPostLoginLoaderProgress(0);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [lastMatch, persistActiveMatch, supabase]);

  const sendInvite = useCallback(async () => {
    if (!lastMatch) return;
    const em = inviteEmail.trim();
    if (!em) {
      setErr("Ingresá el email del jugador (el de su cuenta Supabase).");
      return;
    }
    setErr(null);
    setInfoMsg(null);
    setBusy(true);
    try {
      await rpcInvitePlayerToMatchByEmail(supabase, {
        matchId: lastMatch.id,
        email: em,
        characterId: inviteCharacterId.trim() || null,
      });
      setInfoMsg("Invitación enviada. El jugador la verá en la app (Invitaciones).");
      setInviteEmail("");
      setInviteCharacterId("");
      setShowInviteModal(false);
      void loadPendingInvites();
    } catch (e: unknown) {
      setErr(formatUnknownError(e));
    } finally {
      setBusy(false);
    }
  }, [inviteCharacterId, inviteEmail, lastMatch, loadPendingInvites, supabase]);

  const createMatch = useCallback(async () => {
    setErr(null);
    setInfoMsg(null);
    setBusy(true);
    try {
      const { matchId } = await rpcCreateMatch(supabase, { title: title.trim() || "Sin título" });
      const { data, error } = await supabase
        .from("matches")
        .select("id, code, title, master_user_id, current_scene_text, status, chapter_upgrades_open, chapter_index")
        .eq("id", matchId)
        .single();
      if (error) throw error;
      if (!data) throw new Error("No se pudo leer la partida creada.");
      const muid = data.master_user_id as string | null | undefined;
      if (!muid) throw new Error("La partida no tiene master_user_id.");
      const next: ActiveMatchState = {
        id: data.id,
        code: data.code,
        title: data.title,
        masterUserId: String(muid),
        currentSceneText: (data.current_scene_text as string | null | undefined) ?? null,
        status: String(data.status ?? "draft"),
        chapterUpgradesOpen: Boolean(data.chapter_upgrades_open),
        chapterIndex:
          typeof data.chapter_index === "number" && data.chapter_index >= 1
            ? Math.floor(data.chapter_index)
            : 1,
      };
      setLastMatch(next);
      setMatchDescriptionInput(next.currentSceneText ?? "");
      persistActiveMatch(next);
      setCheckTargetCharacterIds([]);
      setShowNewMatchModal(false);
      void loadMyMatches();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [loadMyMatches, persistActiveMatch, supabase, title]);

  const launchTestCheck = useCallback(async (): Promise<boolean> => {
    if (!lastMatch) return false;
    const dc = Number.parseInt(checkDc.trim(), 10);
    if (Number.isNaN(dc) || dc < 1) {
      setErr("Definí un CHECK válido (entero ≥ 1).");
      return false;
    }
    if (checkTargetCharacterIds.length === 0) {
      setErr("Elegí al menos un personaje: tocá las tarjetas en la grilla (con hoja en esta partida).");
      return false;
    }
    if (checkTargetScope === "single_player" && checkTargetCharacterIds.length !== 1) {
      setErr("Check individual: elegí exactamente un personaje.");
      return false;
    }
    if (checkStatKey == null) {
      setErr("Elegí una estadística para el check (tocá un ícono).");
      return false;
    }
    setErr(null);
    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const masterId = u.user?.id;
      if (!masterId) throw new Error("Sin sesión de master.");

      const targets: { user_id: string; character_id: string }[] = [];
      for (const cid of checkTargetCharacterIds) {
        const sheet = memberSheets.find((m) => m.character_id === cid);
        if (sheet) {
          targets.push({
            user_id: sheet.member_role === "blank" ? masterId : sheet.member_user_id,
            character_id: cid,
          });
          continue;
        }
        const a = assignableChars.find((r) => r.character_id === cid);
        if (a) {
          targets.push({ user_id: a.owner_user_id, character_id: cid });
          continue;
        }
        throw new Error(`No se encontró el personaje en la mesa (${cid.slice(0, 8)}…).`);
      }

      // Asegura asignación activa + runtime para todos los targets antes de abrir el check.
      for (const t of targets) {
        const { error: eAssign } = await supabase
          .from("match_characters")
          .upsert(
            {
              match_id: lastMatch.id,
              user_id: t.user_id,
              character_id: t.character_id,
              is_active: true,
              assigned_by_master_user_id: masterId,
            },
            { onConflict: "match_id,user_id,character_id" },
          );
        if (eAssign) throw eAssign;

        const { error: eRuntime } = await supabase.from("character_runtime").insert({
          match_id: lastMatch.id,
          character_id: t.character_id,
          current_tokens: 5,
          current_modifier: 0,
          check_status: "idle",
          last_result: "none",
        });
        if (eRuntime && eRuntime.code !== "23505") throw eRuntime;
      }

      const statLabel = mapVisibleStatLabel(checkStatKey, null);
      const { data: chk, error: e1 } = await supabase
        .from("checks")
        .insert({
          match_id: lastMatch.id,
          target_scope: checkTargetScope,
          created_by_user_id: masterId,
          stat_key: checkStatKey,
          stat_label_at_time: statLabel,
          check_value: dc,
          important: checkImportant,
          allow_token_spend: true,
          allow_manual_modifier: true,
          status: "open",
        })
        .select("id")
        .single();
      if (e1) throw e1;
      if (!chk) throw new Error("No se creó el check.");

      const rows = targets.map((t) => ({
        check_id: chk.id,
        user_id: t.user_id,
        character_id: t.character_id,
        response_status: "pending" as const,
      }));
      const { error: e2 } = await supabase.from("check_targets").insert(rows);
      if (e2) throw e2;
      return true;
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, [
    assignableChars,
    checkDc,
    checkImportant,
    checkStatKey,
    checkTargetScope,
    checkTargetCharacterIds,
    lastMatch,
    memberSheets,
    supabase,
  ]);

  const nudgeCheckDc = useCallback((delta: number) => {
    setCheckDc((prev) => {
      const parsed = Number.parseInt(prev.trim(), 10);
      const base = Number.isFinite(parsed) ? parsed : 10;
      const next = Math.min(99, Math.max(1, base + delta));
      return String(next);
    });
  }, []);

  const copyMatchCode = useCallback(async () => {
    if (!lastMatch) return;
    try {
      await navigator.clipboard.writeText(lastMatch.code);
      setMatchCodeCopied(true);
      window.setTimeout(() => setMatchCodeCopied(false), 2000);
    } catch {
      setMatchCodeCopied(false);
    }
  }, [lastMatch]);

  const downloadRollHistoryCsv = useCallback(() => {
    if (!lastMatch || rollHistoryRows.length === 0) return;
    const headers = [
      "Fecha",
      "Importante",
      "Personaje",
      "Comentario master",
      "Comentario usuario",
      "Stat",
      "Check objetivo",
      "Dado (tipo)",
      "Mod",
      "Dado tirado",
      "Fichas usadas",
      "Dado explosión 1",
      "Fichas usadas 1",
      "Dado explosión 2",
      "Fichas usadas 2",
      "Dado explosión 3",
      "Fichas usadas 3",
      "Dado explosión 4",
      "Fichas usadas 4",
      "Total tirado",
      "Resultado (paso/no)",
      "Margen",
      "Explota",
    ];
    const lines = [headers.map(csvCell).join(",")];
    for (const r of rollHistoryRows) {
      const d = deriveCheckLogDisplay(r, mesaDisplayRows);
      const row = [
        d.when,
        d.importantStar,
        d.characterLabel,
        d.masterComment,
        d.userComment,
        d.statLabel,
        d.checkValue,
        d.dieAtTime,
        d.modifier,
        d.roll,
        d.tokens,
        d.ex1 ?? "",
        d.ex1Tokens ?? "",
        d.ex2 ?? "",
        d.ex2Tokens ?? "",
        d.ex3 ?? "",
        d.ex3Tokens ?? "",
        d.ex4 ?? "",
        d.ex4Tokens ?? "",
        d.total,
        d.passLabel,
        d.margin,
        d.explodeShort,
      ];
      lines.push(row.map(csvCell).join(","));
    }
    const csv = "\uFEFF" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `historial_tiradas_${lastMatch.code}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [lastMatch, mesaDisplayRows, rollHistoryRows]);

  const checkComposerRows = useMemo(
    () =>
      combinedDisplayRows.filter((r) => Boolean(r.character_id)).map((r) => ({
        characterId: String(r.character_id),
        name: r.character_name?.trim() || "Sin nombre",
        avatarUrl: r.avatar_url?.trim() || null,
      })),
    [combinedDisplayRows],
  );

  return (
    <main className={sessionEmail ? "master-dashboard" : "master-login"}>
      {showPostLoginLoader ? <D20LoadingOverlay progress={postLoginLoaderProgress} /> : null}
      {!sessionEmail ? (
        <section className="master-login__panel" aria-label="Ingreso del master">
          <header className="master-login__hero">
            <h1 className="master-login__title">DXD — Master</h1>
            <p className="master-login__subtitle">
              Iniciá sesión con tu cuenta master para crear o retomar mesas guardadas.
            </p>
          </header>

          <div className="master-login__card">
            <div className="master-login__mode">
              <p className="hint">Modo rápido: nombre sin @ + dominio. También podés usar email completo.</p>
              <button
                type="button"
                className="secondary master-login__modebtn"
                onClick={() => {
                  if (loginUseFullEmail) {
                    const p = parseLoginEmail(fullEmailDirect);
                    setEmailLocal(p.localPart);
                    setEmailDomainChoice(p.domainChoice);
                    setEmailCustomDomain(p.customDomain);
                    setLoginUseFullEmail(false);
                  } else {
                    setFullEmailDirect(
                      buildLoginEmail({
                        localPart: emailLocal,
                        domainChoice: emailDomainChoice,
                        customDomain: emailCustomDomain,
                      }),
                    );
                    setLoginUseFullEmail(true);
                  }
                }}
              >
                {loginUseFullEmail ? "← Modo rápido" : "Escribir email completo"}
              </button>
            </div>

            {loginUseFullEmail ? (
              <>
                <label htmlFor="emailFull">Email completo</label>
                <input
                  id="emailFull"
                  type="email"
                  autoComplete="username"
                  value={fullEmailDirect}
                  onChange={(e) => setFullEmailDirect(e.target.value)}
                  placeholder="nombre@dominio.com"
                />
              </>
            ) : (
              <>
                <label htmlFor="emailLocal">Nombre (sin @)</label>
                <div className="master-login__quickrow">
                  <input
                    id="emailLocal"
                    type="text"
                    autoComplete="username"
                    value={emailLocal}
                    onChange={(e) => setEmailLocal(e.target.value)}
                    placeholder="ej. maria.perez"
                  />
                  <select
                    aria-label="Dominio de correo"
                    className="master-login__domainselect"
                    value={emailDomainChoice}
                    onChange={(e) => setEmailDomainChoice(e.target.value)}
                  >
                    {LOGIN_EMAIL_DOMAIN_SUFFIXES.map((suffix) => (
                      <option key={suffix} value={suffix}>
                        {suffix.replace("@", "")}
                      </option>
                    ))}
                    <option value={LOGIN_EMAIL_CUSTOM}>Otro…</option>
                  </select>
                </div>
                {emailDomainChoice === LOGIN_EMAIL_CUSTOM ? (
                  <>
                    <label htmlFor="emailCustomDom">Dominio (sin @)</label>
                    <input
                      id="emailCustomDom"
                      type="text"
                      value={emailCustomDomain}
                      onChange={(e) => setEmailCustomDomain(e.target.value)}
                      placeholder="ej. outlook.com.ar"
                    />
                  </>
                ) : null}
              </>
            )}

            <label htmlFor="password">Contraseña</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {recentEmails.length > 0 ? (
              <>
                <span className="hint master-login__hintlabel">Recientes</span>
                <div className="master-login__chips">
                  {recentEmails.map((em) => (
                    <button
                      key={em}
                      type="button"
                      className="secondary master-login__recent"
                      onClick={() => {
                        const p = parseLoginEmail(em);
                        setEmailLocal(p.localPart);
                        setEmailDomainChoice(p.domainChoice);
                        setEmailCustomDomain(p.customDomain);
                        setFullEmailDirect(em);
                        setLoginUseFullEmail(false);
                      }}
                    >
                      {em}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            <button type="button" className="master-login__submit" disabled={busy} onClick={() => void signIn()}>
              {busy ? "Ingresando..." : "Entrar"}
            </button>
          </div>
        </section>
      ) : (
        <>
          <header className="dash-topbar">
            <div className="dash-topbar__brand">
              <button
                type="button"
                className="secondary dash-topbar__menubtn"
                disabled={busy}
                aria-label="Abrir menú lateral"
                onClick={() => setShowSideMenu(true)}
              >
                ☰
              </button>
              {lastMatch ? (
                <button
                  type="button"
                  className="dash-topbar__back"
                  disabled={busy}
                  aria-label="Volver al listado de partidas"
                  onClick={() => {
                    setLastMatch(null);
                    persistActiveMatch(null);
                    setMatchDescriptionInput("");
                    void loadMyMatches();
                  }}
                >
                  ← Partidas
                </button>
              ) : null}
              <h1 className="dash-app-title">DXD</h1>
              {lastMatch ? (
                <span className="dash-topbar__strap">Mesa activa</span>
              ) : (
                <span className="dash-topbar__strap">Tus mesas</span>
              )}
            </div>
            <div className="dash-topbar__actions">
              {lastMatch ? (
                <button
                  type="button"
                  className="secondary dash-topbar__roll-history"
                  disabled={busy}
                  onClick={() => {
                    setShowBlankManagerModal(true);
                    setShowBlankEditor(false);
                    setSelectedBlankId(null);
                    setTemplateCreateKind("master_npc");
                    setGrantPetCharacterId("");
                    setGrantPetPlayerUserId("");
                    setBlankFormName("");
                    setBlankFormAvatarUrl("");
                    setBlankFormDice(EMPTY_BLANK_DICE);
                    setBlankFormTraining(EMPTY_BLANK_TRAINING);
                    setBlankFormAvatarFile(null);
                    setBlankFormAvatarPreview("");
                    void loadMasterBlankCharacters();
                  }}
                >
                  Personajes
                </button>
              ) : null}
              {lastMatch ? (
                <button
                  type="button"
                  className="secondary dash-topbar__roll-history"
                  disabled={busy}
                  onClick={() => {
                    setShowRollHistoryModal(true);
                    void loadRollHistoryModal();
                  }}
                >
                  Historial de tiradas
                </button>
              ) : null}
              {!lastMatch ? (
                <button
                  type="button"
                  className="dash-topbar__iconbtn"
                  disabled={busy || myMatchesLoading}
                  aria-label="Actualizar partidas"
                  title="Actualizar lista"
                  onClick={() => void loadMyMatches()}
                >
                  ↻
                </button>
              ) : null}
              <button type="button" className="secondary dash-topbar__signout" disabled={busy} onClick={() => void signOut()}>
                Salir
              </button>
            </div>
          </header>
          {showSideMenu ? (
            <div className="dash-sidemenu-overlay" role="presentation" onClick={() => setShowSideMenu(false)}>
              <aside
                className="dash-sidemenu"
                role="dialog"
                aria-modal="true"
                aria-label="Menú principal"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="dash-sidemenu__head">
                  <h3 className="dash-sidemenu__title">
                    Menú
                    {lastMatch?.code ? (
                      <button
                        type="button"
                        className="dash-sidemenu__matchcode-btn"
                        title={matchCodeCopied ? "Copiado" : "Copiar código"}
                        aria-label={matchCodeCopied ? "Código copiado al portapapeles" : `Copiar código ${lastMatch.code}`}
                        disabled={busy}
                        onClick={() => void copyMatchCode()}
                      >
                        {lastMatch.code}
                      </button>
                    ) : null}
                  </h3>
                  <button
                    type="button"
                    className="secondary dash-sidemenu__close"
                    onClick={() => setShowSideMenu(false)}
                  >
                    ✕
                  </button>
                </div>
                <nav className="dash-sidemenu__nav" aria-label="Navegación principal">
                  <button
                    type="button"
                    className="secondary dash-sidemenu__item"
                    disabled={busy}
                    onClick={() => {
                      setLastMatch(null);
                      persistActiveMatch(null);
                      setMatchDescriptionInput("");
                      setShowSideMenu(false);
                      void loadMyMatches();
                    }}
                  >
                    Inicio
                  </button>
                  <button
                    type="button"
                    className="secondary dash-sidemenu__item"
                    disabled={busy || !lastMatch}
                    onClick={() => {
                      if (!lastMatch) return;
                      setShowInviteModal(true);
                      setShowSideMenu(false);
                    }}
                  >
                    Invitar
                  </button>
                  <button
                    type="button"
                    className="secondary dash-sidemenu__item"
                    disabled={busy}
                    onClick={() => {
                      setStrengthReferenceOpen("i");
                      setShowSideMenu(false);
                    }}
                  >
                    Strength I
                  </button>
                  <button
                    type="button"
                    className="secondary dash-sidemenu__item"
                    disabled={busy}
                    onClick={() => {
                      setStrengthReferenceOpen("ii");
                      setShowSideMenu(false);
                    }}
                  >
                    Strength II
                  </button>
                </nav>
              </aside>
            </div>
          ) : null}

          {strengthReferenceOpen ? (
            <div
              className="match-modal-overlay strength-ref-overlay"
              role="presentation"
              onClick={() => setStrengthReferenceOpen(null)}
            >
              <div
                className="match-modal strength-ref-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="strength-ref-heading"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 id="strength-ref-heading" className="match-modal__heading">
                  {strengthReferenceOpen === "i" ? "Strengths I" : "Strengths II"}
                </h3>
                <p className="strength-ref-modal__hint">Descripciones orientativas; podés ajustarlas en el archivo de datos del proyecto.</p>
                <ul className="strength-ref-modal__list">
                  {(strengthReferenceOpen === "i" ? STRENGTHS_I_REFERENCE : STRENGTHS_II_REFERENCE).map((row) => (
                    <li key={row.key} className="strength-ref-modal__item">
                      <div className="strength-ref-modal__name">{row.name}</div>
                      <p className="strength-ref-modal__desc">{row.descriptionEs}</p>
                    </li>
                  ))}
                </ul>
                <div className="match-modal__actions">
                  <button type="button" className="secondary" onClick={() => setStrengthReferenceOpen(null)}>
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {lastMatch ? (
            <>
              <div className="active-match-hub">
              <section className="active-match-strip" aria-label="Datos de la partida">
                <div className="active-match-strip__topbar">
                  <div className="active-match-strip__topbar-side active-match-strip__topbar-side--left">
                  </div>
                  <div className="active-match-strip__title-block">
                    <h2 className="active-match-strip__title active-match-strip__title--topbar">{lastMatch.title}</h2>
                  </div>
                  <div className="active-match-strip__topbar-side active-match-strip__topbar-side--right">
                    <label className="active-match-strip__upgrades-inline">
                      <span className="active-match-strip__upgrades-inline-label">Mejoras</span>
                      <div className="active-match-strip__switch-paddle">
                        <input
                          id="master-chapter-upgrades-switch"
                          type="checkbox"
                          className="active-match-strip__switch-input"
                          role="switch"
                          aria-checked={lastMatch.chapterUpgradesOpen}
                          checked={lastMatch.chapterUpgradesOpen}
                          disabled={busy}
                          onChange={(e) => void setChapterUpgradesEnabled(e.target.checked)}
                        />
                        <span className="active-match-strip__switch-track" aria-hidden="true">
                          <span className="active-match-strip__switch-thumb" />
                        </span>
                      </div>
                    </label>
                  </div>
                </div>
                <div className="active-match-strip__roll-log" aria-labelledby="active-match-roll-log-heading">
                  <h3 id="active-match-roll-log-heading" className="active-match-strip__roll-log-title">
                    Últimas tiradas
                  </h3>
                  {checkLogRows.length === 0 ? (
                    <p className="active-match-strip__roll-log-empty">Todavía no hay respuestas enviadas.</p>
                  ) : (
                    <ul className="active-match-strip__roll-log-list">
                      {checkLogRows.map((r) => {
                        const d = deriveCheckLogDisplay(r, mesaDisplayRows);
                        return (
                          <li
                            key={r.id}
                            className={`active-match-strip__roll-log-item${
                              d.checkOutcome === "pass"
                                ? " active-match-strip__roll-log-item--pass"
                                : d.checkOutcome === "fail"
                                  ? " active-match-strip__roll-log-item--fail"
                                  : ""
                            }`}
                          >
                            <span className="active-match-strip__roll-log-when">{d.when}</span>
                            <div className="active-match-strip__roll-log-card">
                              <div
                                className={`active-match-strip__roll-log-result${
                                  d.checkOutcome === "pass"
                                    ? " active-match-strip__roll-log-result--pass"
                                    : d.checkOutcome === "fail"
                                      ? " active-match-strip__roll-log-result--fail"
                                      : ""
                                }`}
                              >
                                {d.passLabel}
                              </div>
                              <div
                                className={`active-match-strip__roll-log-body${
                                  d.checkOutcome === "pass"
                                    ? " active-match-strip__roll-log-body--pass"
                                    : d.checkOutcome === "fail"
                                      ? " active-match-strip__roll-log-body--fail"
                                      : ""
                                }`}
                              >
                                <span className="active-match-strip__roll-log-txt">
                                  CHECK {d.checkValue} · {d.statLabel}
                                </span>
                                <span className="active-match-strip__roll-log-txt">
                                  {d.characterLabel} · Dado {d.roll} · Mod {d.modifierLabel} ({d.trainingShort})
                                </span>
                                <span className="active-match-strip__roll-log-txt">
                                  {d.explodeCount > 0
                                    ? `EXPLOTÓ ${d.explodeCount} ${d.explodeCount === 1 ? "VEZ" : "VECES"}`
                                    : "NO EXPLOTÓ"}
                                </span>
                                {d.userComment !== "—" ? (
                                  <span className="active-match-strip__roll-log-txt">COMENTARIO: {d.userComment}</span>
                                ) : null}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </section>

              <aside className="active-match-description-aside" aria-label="Descripción de la partida">
                <div className="active-match-strip__description-block">
                  <label className="active-match-strip__description-label" htmlFor="match-description-input">
                    Descripción de la partida
                  </label>
                  <textarea
                    id="match-description-input"
                    className="active-match-strip__description-input"
                    rows={6}
                    value={matchDescriptionInput}
                    onChange={(e) => setMatchDescriptionInput(e.target.value)}
                    onBlur={() => void flushMatchDescription()}
                    placeholder="Resumen para vos: escenario, tono, reglas caseras… Se guarda al salir del cuadro de texto."
                    disabled={busy}
                  />
                  {savingMatchDescription ? (
                    <p className="active-match-strip__description-status">Guardando…</p>
                  ) : null}
                </div>
              </aside>
              </div>

              <section className="master-check-strip" aria-labelledby="master-check-strip-heading">
                <h3 id="master-check-strip-heading" className="master-check-strip__stats-head">
                  Check
                </h3>
                <div className="master-check-strip__row">
                  <p className="master-check-strip__summary">
                    Seleccionados: <strong>{checkTargetCharacterIds.length}</strong>
                  </p>
                  <div className="master-check-strip__actions">
                    <button
                      type="button"
                      className="master-check-strip__check-btn"
                      disabled={busy}
                      onClick={() => {
                        setCheckTargetScope("single_player");
                        setCheckTargetCharacterIds((prev) => (prev.length > 0 ? [prev[0]] : []));
                        setShowCheckComposerModal(true);
                      }}
                    >
                      Check
                    </button>
                    <button
                      type="button"
                      className="master-check-strip__chapter-btn"
                      disabled={busy}
                      onClick={() => void endChapter()}
                    >
                      Terminar capítulo
                    </button>
                  </div>
                </div>
              </section>

              <section className="mesa-players-section" aria-labelledby="mesa-players-heading">
                <h3 id="mesa-players-heading" className="mesa-section-title">
                  Jugadores e invitaciones
                </h3>
                {combinedDisplayRows.length === 0 && pendingInvites.length === 0 ? (
                  <div className="mesa-callout mesa-callout--empty" role="status">
                    <p className="mesa-callout__title">Sin jugadores visibles</p>
                    <ul className="mesa-callout__list">
                      <li>
                        {members.length === 0
                          ? "Todavía no hay nadie en la mesa: compartí el código o usá Invitar por mail."
                          : "Hay miembros pero no se cargaron las tarjetas: revisá el error abajo o la migración SQL de la lista enriquecida."}
                      </li>
                    </ul>
                  </div>
                ) : (
                  <MesaCharacterGrid
                    rows={combinedDisplayRows}
                    pendingInvites={pendingInvites}
                    masterUserId={lastMatch.masterUserId}
                    kickingUserId={kickingUserId}
                    onKickMember={(uid) => void kickMemberFromMatch(uid)}
                    checkTargetCharacterIds={checkTargetCharacterIds}
                    onToggleCheckTarget={toggleCheckTarget}
                    onAdjustTokens={(characterId, displayName, delta) =>
                      void adjustCharacterTokens(characterId, displayName, delta)
                    }
                    statsByCharacterId={{ ...memberStatsByCharacterId, ...blankStatsByCharacterId }}
                  />
                )}
              </section>

              {grantTokensModal ? (
                <div
                  className="match-modal-overlay"
                  role="presentation"
                  onClick={() => !grantingTokens && setGrantTokensModal(null)}
                >
                  <div
                    className="match-modal"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="grant-tokens-title"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <h3 id="grant-tokens-title" className="match-modal__heading">
                      Otorgar fichas
                    </h3>
                    <p className="hint match-modal__hint">
                      Personaje: <strong>{grantTokensModal.displayName}</strong>. Se suman a las fichas en mesa de ese
                      personaje (runtime de la partida).
                    </p>
                    <label htmlFor="grant-amount-input">Cantidad (1–500)</label>
                    <input
                      id="grant-amount-input"
                      type="number"
                      min={1}
                      max={500}
                      value={grantAmountInput}
                      onChange={(e) => setGrantAmountInput(e.target.value)}
                      disabled={grantingTokens}
                    />
                    <div className="match-modal__actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={grantingTokens}
                        onClick={() => setGrantTokensModal(null)}
                      >
                        Cancelar
                      </button>
                      <button type="button" disabled={grantingTokens} onClick={() => void submitGrantTokens()}>
                        {grantingTokens ? "Aplicando…" : "Otorgar"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {showCheckComposerModal ? (
                <div
                  className="match-modal-overlay"
                  role="presentation"
                  onClick={() => !busy && setShowCheckComposerModal(false)}
                >
                  <div
                    className="match-modal match-modal--check-composer"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Configurar check"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="check-composer__scope" role="group" aria-label="Tipo de check">
                      <button
                        type="button"
                        className={`check-composer__scope-btn${checkTargetScope === "single_player" ? " check-composer__scope-btn--on" : ""}`}
                        disabled={busy}
                        onClick={() => {
                          setCheckTargetScope("single_player");
                          setCheckTargetCharacterIds((prev) => (prev.length > 0 ? [prev[0]] : []));
                        }}
                      >
                        Individual
                      </button>
                      <button
                        type="button"
                        className={`check-composer__scope-btn${checkTargetScope === "multiple_players" ? " check-composer__scope-btn--on" : ""}`}
                        disabled={busy}
                        onClick={() => setCheckTargetScope("multiple_players")}
                      >
                        Grupal
                      </button>
                      <button
                        type="button"
                        className={`check-composer__scope-star${checkImportant ? " check-composer__scope-star--on" : ""}`}
                        aria-label={checkImportant ? "Check importante activado" : "Marcar check como importante"}
                        aria-pressed={checkImportant}
                        disabled={busy}
                        onClick={() => setCheckImportant((v) => !v)}
                      >
                        <Icon path={checkImportant ? mdiStar : mdiStarOutline} size="4.3rem" aria-hidden />
                      </button>
                    </div>
                    <div className="check-composer__hex-and-targets">
                      <div className="check-composer__hex-stage" role="group" aria-label="Stat y valor del check">
                        <div className="check-composer__hex-wrap">
                          {STAT_KEYS.map((k) => (
                            <button
                              key={k}
                              type="button"
                              className={`check-composer__hex-stat check-composer__hex-stat--${k}${checkStatKey === k ? " check-composer__hex-stat--on" : ""}`}
                              title={mapVisibleStatLabel(k, null)}
                              aria-pressed={checkStatKey === k}
                              aria-label={mapVisibleStatLabel(k, null)}
                              disabled={busy}
                              onClick={() => setCheckStatKey((prev) => (prev === k ? null : k))}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                aria-hidden="true"
                                className="check-composer__hex-stat-icon"
                              >
                                <path d={STAT_ICON_PATHS[k]} />
                              </svg>
                            </button>
                          ))}
                          <svg
                            className="check-composer__hex-outline"
                            viewBox="0 0 100 100"
                            aria-hidden="true"
                          >
                            <polygon points="50,2 90,25 90,75 50,98 10,75 10,25" />
                          </svg>
                          <div className="check-composer__hex-core" aria-live="polite">
                            <div className="check-composer__hex-value-row">
                              <button
                                type="button"
                                className="check-composer__hex-step"
                                aria-label="Bajar check"
                                disabled={busy}
                                onClick={() => nudgeCheckDc(-1)}
                              >
                                −
                              </button>
                              <input
                                id="check-value-input"
                                className="check-composer__hex-input"
                                type="number"
                                min={1}
                                max={99}
                                value={checkDc}
                                onChange={(e) => setCheckDc(e.target.value)}
                                disabled={busy}
                                aria-label="Valor numérico del check"
                              />
                              <button
                                type="button"
                                className="check-composer__hex-step"
                                aria-label="Subir check"
                                disabled={busy}
                                onClick={() => nudgeCheckDc(1)}
                              >
                                +
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="check-composer__targets" role="group" aria-label="Objetivos del check">
                        {checkComposerRows.map((r) => {
                          const selected = checkTargetCharacterIds.includes(r.characterId);
                          return (
                            <button
                              key={r.characterId}
                              type="button"
                              className={`check-composer__target${selected ? " check-composer__target--on" : ""}`}
                              disabled={busy}
                              onClick={() => toggleCheckTarget(r.characterId)}
                              title={r.name}
                              aria-pressed={selected}
                            >
                              {r.avatarUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={r.avatarUrl} alt={r.name} className="check-composer__target-img" />
                              ) : (
                                <span className="check-composer__target-fallback" aria-hidden>
                                  👤
                                </span>
                              )}
                              <span className="check-composer__target-name">{r.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="match-modal__actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() => setShowCheckComposerModal(false)}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          const ok = await launchTestCheck();
                          if (ok) setShowCheckComposerModal(false);
                        }}
                      >
                        Enviar check
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {showRollHistoryModal ? (
                <div
                  className="match-modal-overlay"
                  role="presentation"
                  onClick={() => !rollHistoryLoading && !busy && setShowRollHistoryModal(false)}
                >
                  <div
                    className="match-modal match-modal--roll-history"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="roll-history-modal-title"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="roll-history-modal__head">
                      <h3 id="roll-history-modal-title" className="match-modal__heading">
                        Historial de tiradas
                      </h3>
                      <button
                        type="button"
                        className="secondary roll-history-modal__csv-btn"
                        disabled={rollHistoryLoading || rollHistoryRows.length === 0}
                        onClick={() => downloadRollHistoryCsv()}
                      >
                        Descargar CSV
                      </button>
                    </div>
                    <p className="hint match-modal__hint">Todas las respuestas a checks registradas en esta mesa.</p>
                    <div className="roll-history-modal__body">
                      {rollHistoryLoading ? (
                        <p className="roll-history-modal__status">Cargando…</p>
                      ) : rollHistoryRows.length === 0 ? (
                        <p className="roll-history-modal__status">Todavía no hay tiradas registradas.</p>
                      ) : (
                        <div className="roll-history-modal__scroll">
                          <table className="roll-history-table roll-history-table--full">
                            <thead>
                              <tr>
                                <th>Fecha</th>
                                <th>Personaje</th>
                                <th>Stat</th>
                                <th>CHECK</th>
                                <th>Dado</th>
                                <th>Mod stat</th>
                                <th title="Cara del dado y fichas de mesa usadas en la tirada principal">Principal</th>
                                <th title="Explosión 1: cara del dado y fichas usadas">Exp 1</th>
                                <th title="Explosión 2: cara del dado y fichas usadas">Exp 2</th>
                                <th title="Explosión 3: cara del dado y fichas usadas">Exp 3</th>
                                <th title="Explosión 4: cara del dado y fichas usadas">Exp 4</th>
                                <th>Total</th>
                                <th>Margen</th>
                                <th>Resultado</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rollHistoryRows.map((r) => {
                                const d = deriveCheckLogDisplay(r, mesaDisplayRows);
                                return (
                                  <tr key={r.id}>
                                    <td>{d.when}</td>
                                    <td>{d.characterLabel}</td>
                                    <td>{d.statLabel}</td>
                                    <td>{d.checkValue}</td>
                                    <td>{d.dieAtTime}</td>
                                    <td>{d.modifier >= 0 ? `+${d.modifier}` : String(d.modifier)}</td>
                                    <td>
                                      <RollHistoryDiceFichasCell roll={d.roll} tokens={d.tokens} />
                                    </td>
                                    <td>
                                      <RollHistoryDiceFichasCell roll={d.ex1} tokens={d.ex1Tokens} />
                                    </td>
                                    <td>
                                      <RollHistoryDiceFichasCell roll={d.ex2} tokens={d.ex2Tokens} />
                                    </td>
                                    <td>
                                      <RollHistoryDiceFichasCell roll={d.ex3} tokens={d.ex3Tokens} />
                                    </td>
                                    <td>
                                      <RollHistoryDiceFichasCell roll={d.ex4} tokens={d.ex4Tokens} />
                                    </td>
                                    <td>{d.finalResult}</td>
                                    <td>{d.margin}</td>
                                    <td>{d.passLabel}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                    <div className="match-modal__actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={rollHistoryLoading}
                        onClick={() => setShowRollHistoryModal(false)}
                      >
                        Cerrar
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {showBlankManagerModal ? (
                <div
                  className="match-modal-overlay"
                  role="presentation"
                  onClick={() => !busy && setShowBlankManagerModal(false)}
                >
                  <div
                    className="match-modal match-modal--blank-manager"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="blank-manager-title"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <h3 id="blank-manager-title" className="match-modal__heading">
                      NPC / PET (solo stats)
                    </h3>
                    <p className="hint match-modal__hint">
                      <strong>NPC</strong>: lo usás vos en tu fila de director.{" "}
                      <strong>PET</strong>: lo cedés a un jugador (solo stats; elige ese PET como hoja activa).
                    </p>
                    <div className="blank-manager-hub">
                      <div className="blank-manager-hub__grid">
                        {masterBlankCharacters.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className={`match-hub-card blank-hub-card${selectedBlankId === c.id && showBlankEditor ? " blank-hub-card--selected" : ""}`}
                            disabled={busy}
                            onClick={() => {
                              setSelectedBlankId(c.id);
                              setShowBlankEditor(true);
                            }}
                          >
                            <div className="match-hub-card__head">
                              <code className="match-hub-card__code">
                                {c.origin === "master_pet"
                                  ? c.grantedToLabel
                                    ? "CEDIDO"
                                    : "PET"
                                  : c.inMesa
                                    ? "EN MESA"
                                    : "NPC"}
                              </code>
                              <span className="match-hub-card__status match-hub-card__status--draft">
                                {c.origin === "master_pet" ? "PET" : "NPC"}
                              </span>
                            </div>
                            <span className="match-hub-card__title">{c.name}</span>
                            <span className="match-hub-card__date">
                              {c.origin === "master_pet"
                                ? c.grantedToLabel
                                  ? `Jugador: ${c.grantedToLabel}`
                                  : "Sin ceder (elegí abajo)"
                                : c.inMesa
                                  ? "En tu fila como NPC"
                                  : "Sin usar en mesa"}
                            </span>
                          </button>
                        ))}
                        <button
                          type="button"
                          className="match-hub-card match-hub-card--new blank-hub-card--new"
                          disabled={busy}
                          onClick={() => {
                            setSelectedBlankId(null);
                            setTemplateCreateKind("master_npc");
                            setBlankFormName("");
                            setBlankFormAvatarUrl("");
                            setBlankFormDice(EMPTY_BLANK_DICE);
                            setBlankFormTraining(EMPTY_BLANK_TRAINING);
                            setBlankFormAvatarFile(null);
                            setBlankFormAvatarPreview("");
                            setShowBlankEditor(true);
                          }}
                        >
                          <span className="match-hub-card__plus" aria-hidden>
                            +
                          </span>
                          <span className="match-hub-card__newlabel">Nuevo NPC o PET</span>
                        </button>
                      </div>
                      <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                        <label htmlFor="grant-pet-select">Ceder PET a jugador</label>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
                          <select
                            id="grant-pet-select"
                            value={grantPetCharacterId}
                            disabled={busy}
                            onChange={(e) => setGrantPetCharacterId(e.target.value)}
                            aria-label="Elegir PET"
                          >
                            <option value="">Elegí un PET…</option>
                            {masterBlankCharacters
                              .filter((c) => c.origin === "master_pet")
                              .map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                  {c.grantedToLabel ? ` (ya → ${c.grantedToLabel})` : ""}
                                </option>
                              ))}
                          </select>
                          <select
                            id="grant-pet-player-select"
                            value={grantPetPlayerUserId}
                            disabled={busy}
                            onChange={(e) => setGrantPetPlayerUserId(e.target.value)}
                            aria-label="Elegir jugador"
                          >
                            <option value="">Jugador en mesa…</option>
                            {memberSheets
                              .filter((m) => m.member_role === "player")
                              .map((m) => (
                                <option key={m.member_user_id} value={m.member_user_id}>
                                  {m.owner_display?.trim() || m.member_user_id.slice(0, 8)}
                                </option>
                              ))}
                          </select>
                          <button
                            type="button"
                            disabled={busy || masterBlankCharacters.filter((x) => x.origin === "master_pet").length === 0}
                            onClick={() => void grantPetToPlayer()}
                          >
                            Ceder
                          </button>
                        </div>
                      </div>
                      {masterBlankCharacters.length === 0 && !showBlankEditor ? (
                        <p className="roll-history-modal__status">
                          Todavía no hay plantillas. Usá el cuadrado + para crear un NPC o PET.
                        </p>
                      ) : null}
                    </div>
                    <div className="match-modal__actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() => setShowBlankManagerModal(false)}
                      >
                        Cerrar
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {showBlankManagerModal && showBlankEditor ? (
                <div
                  className="match-modal-overlay"
                  role="presentation"
                  onClick={() => !busy && setShowBlankEditor(false)}
                >
                  <div
                    className="match-modal match-modal--blank-editor"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Editor NPC/PET"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="blank-manager__editor">
                      {selectedBlankId ? (
                        <p className="hint match-modal__hint" style={{ marginTop: 0 }}>
                          Tipo:{" "}
                          <strong>
                            {masterBlankCharacters.find((c) => c.id === selectedBlankId)?.origin === "master_pet"
                              ? "PET"
                              : "NPC"}
                          </strong>{" "}
                          (no se puede cambiar; creá otro desde el gestor.)
                        </p>
                      ) : (
                        <div className="check-composer__scope" role="group" aria-label="Tipo plantilla nueva" style={{ marginBottom: "0.75rem" }}>
                          <button
                            type="button"
                            className={`check-composer__scope-btn${templateCreateKind === "master_npc" ? " check-composer__scope-btn--on" : ""}`}
                            disabled={busy}
                            onClick={() => setTemplateCreateKind("master_npc")}
                          >
                            NPC (mesa director)
                          </button>
                          <button
                            type="button"
                            className={`check-composer__scope-btn${templateCreateKind === "master_pet" ? " check-composer__scope-btn--on" : ""}`}
                            disabled={busy}
                            onClick={() => setTemplateCreateKind("master_pet")}
                          >
                            PET (cedible)
                          </button>
                        </div>
                      )}
                      <div className="blank-manager__editor-head">
                        <div className="blank-manager__avatar-col">
                          <button type="button" className="blank-manager__avatar-btn" onClick={onPickBlankAvatar}>
                            {blankFormAvatarPreview || blankFormAvatarUrl.trim() ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={blankFormAvatarPreview || blankFormAvatarUrl.trim()}
                                alt="Avatar"
                                className="blank-manager__avatar-img"
                              />
                            ) : (
                              <span className="blank-manager__avatar-placeholder">Tocar para importar</span>
                            )}
                          </button>
                          <input
                            ref={blankAvatarInputRef}
                            type="file"
                            accept="image/*"
                            className="blank-manager__avatar-input"
                            onChange={onBlankAvatarFileChange}
                          />
                        </div>
                        <div className="blank-manager__editor-fields">
                          <label htmlFor="blank-name-input">Nombre</label>
                          <input
                            id="blank-name-input"
                            value={blankFormName}
                            onChange={(e) => setBlankFormName(e.target.value)}
                            placeholder="Nombre visible en mesa"
                            autoComplete="off"
                          />
                          <label htmlFor="blank-avatar-input">Avatar URL (opcional)</label>
                          <input
                            id="blank-avatar-input"
                            value={blankFormAvatarUrl}
                            onChange={(e) => setBlankFormAvatarUrl(e.target.value)}
                            placeholder="https://..."
                            autoComplete="off"
                          />
                        </div>
                      </div>
                      <div className="blank-manager__stats">
                        {STAT_KEYS.map((k) => (
                          <div key={k} className="blank-manager__stat-field">
                            <label>{mapVisibleStatLabel(k, null)}</label>
                            <div className="blank-manager__dice-stepper">
                              <button
                                type="button"
                                className="blank-manager__dice-step"
                                disabled={busy}
                                onClick={() => bumpBlankDie(k, -1)}
                                aria-label={`Bajar dado de ${mapVisibleStatLabel(k, null)}`}
                              >
                                ▼
                              </button>
                              <span className="blank-manager__dice-value">d{blankFormDice[k]}</span>
                              <button
                                type="button"
                                className="blank-manager__dice-step"
                                disabled={busy}
                                onClick={() => bumpBlankDie(k, 1)}
                                aria-label={`Subir dado de ${mapVisibleStatLabel(k, null)}`}
                              >
                                ▲
                              </button>
                            </div>
                            <div className="blank-manager__tier-row">
                              {BLANK_TRAINING_OPTIONS.map((opt) => (
                                <button
                                  key={opt.value}
                                  type="button"
                                  className={`blank-manager__tier-btn${blankFormTraining[k] === opt.value ? " blank-manager__tier-btn--on" : ""}`}
                                  aria-pressed={blankFormTraining[k] === opt.value}
                                  disabled={busy}
                                  onClick={() =>
                                    setBlankFormTraining((prev) => ({
                                      ...prev,
                                      [k]: prev[k] === opt.value ? "none" : opt.value,
                                    }))
                                  }
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="blank-manager__editor-actions">
                        <button type="button" className="secondary" disabled={busy} onClick={() => setShowBlankEditor(false)}>
                          Cancelar
                        </button>
                        <button type="button" disabled={busy} onClick={() => void saveBlankCharacter()}>
                          {selectedBlankId ? "Guardar cambios" : "Crear"}
                        </button>
                      </div>
                      {selectedBlankId &&
                      masterBlankCharacters.find((c) => c.id === selectedBlankId)?.origin !== "master_pet" ? (
                        <div className="blank-manager__editor-actions">
                          <button
                            type="button"
                            className="secondary"
                            disabled={busy}
                            onClick={() => void addBlankToMesa(selectedBlankId)}
                          >
                            Agregar NPC a mesa (tu fila)
                          </button>
                        </div>
                      ) : null}
                      {selectedBlankId ? (
                        <div className="blank-manager__editor-actions">
                          <button
                            type="button"
                            className="secondary"
                            disabled={busy}
                            onClick={() => void deleteBlankCharacter(selectedBlankId)}
                          >
                            Eliminar plantilla
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}

              {showInviteModal ? (
                <div
                  className="match-modal-overlay"
                  role="presentation"
                  onClick={() => !busy && setShowInviteModal(false)}
                >
                  <div
                    className="match-modal"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="invite-modal-title"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <h3 id="invite-modal-title" className="match-modal__heading">
                      Invitar jugador
                    </h3>
                    <p className="hint match-modal__hint">
                      Email de la cuenta en Supabase (el mismo que usa en la app). Opcional: UUID de un personaje suyo.
                    </p>
                    <label htmlFor="invite-email-modal">Email</label>
                    <input
                      id="invite-email-modal"
                      type="email"
                      autoComplete="off"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="jugador@mail.com"
                    />
                    <label htmlFor="invite-char-modal">UUID personaje (opcional)</label>
                    <input
                      id="invite-char-modal"
                      value={inviteCharacterId}
                      onChange={(e) => setInviteCharacterId(e.target.value)}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      autoComplete="off"
                    />
                    <div className="match-modal__actions">
                      <button type="button" className="secondary" disabled={busy} onClick={() => setShowInviteModal(false)}>
                        Cancelar
                      </button>
                      <button type="button" disabled={busy} onClick={() => void sendInvite()}>
                        Enviar invitación
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <p className="hint dash-intro match-hub-intro">
                Tocá un cuadrado para abrir una partida. El <strong>+</strong> crea una nueva. Solo ves las tuyas.
              </p>

              <section className="match-hub" aria-label="Partidas guardadas">
                {myMatchesLoading && savedMatches.length === 0 ? (
                  <div className="match-hub-grid match-hub-grid--loading">
                    <div className="match-hub-skeleton" />
                    <div className="match-hub-skeleton" />
                    <div className="match-hub-skeleton" />
                  </div>
                ) : (
                  <div className="match-hub-grid">
                    {savedMatches.map((m) => (
                      <div key={m.id} className="match-hub-card-wrap">
                        <button
                          type="button"
                          className="match-hub-card"
                          disabled={busy || deletingMatchId === m.id}
                          onClick={() => openSavedMatch(m)}
                        >
                          <div className="match-hub-card__head">
                            <code className="match-hub-card__code">{m.code}</code>
                            <span className={`match-hub-card__status match-hub-card__status--${m.status}`}>
                              {matchStatusLabel(m.status)}
                            </span>
                          </div>
                          <span className="match-hub-card__title">{m.title}</span>
                          <span className="match-hub-card__date">
                            {new Date(m.created_at).toLocaleString("es-AR", {
                              dateStyle: "short",
                              timeStyle: "short",
                            })}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="match-hub-card__trash"
                          disabled={busy || deletingMatchId === m.id}
                          title="Eliminar partida"
                          aria-label={`Eliminar partida ${m.title}`}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void deleteSavedMatch(m);
                          }}
                        >
                          {deletingMatchId === m.id ? "…" : "×"}
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="match-hub-card match-hub-card--new"
                      disabled={busy}
                      onClick={() => setShowNewMatchModal(true)}
                    >
                      <span className="match-hub-card__plus" aria-hidden>
                        +
                      </span>
                      <span className="match-hub-card__newlabel">Nueva partida</span>
                    </button>
                  </div>
                )}
              </section>

              {showNewMatchModal ? (
                <div
                  className="match-modal-overlay"
                  role="presentation"
                  onClick={() => !busy && setShowNewMatchModal(false)}
                >
                  <div
                    className="match-modal"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="new-match-title"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <h3 id="new-match-title" className="match-modal__heading">
                      Nueva partida
                    </h3>
                    <p className="hint match-modal__hint">Nombre visible para vos (ej. ROLEADA1).</p>
                    <label htmlFor="title-modal">Nombre</label>
                    <input
                      id="title-modal"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="ROLEADA1"
                      autoComplete="off"
                      autoFocus
                    />
                    <div className="match-modal__actions">
                      <button type="button" className="secondary" disabled={busy} onClick={() => setShowNewMatchModal(false)}>
                        Cancelar
                      </button>
                      <button type="button" disabled={busy} onClick={() => void createMatch()}>
                        Crear
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </>
      )}

      {infoMsg ? (
        <p
          className={sessionEmail ? "hint dash-success" : "hint"}
          style={sessionEmail ? undefined : { color: "var(--mesa-line)" }}
        >
          {infoMsg}
        </p>
      ) : null}
      {err ? <p className="error">{err}</p> : null}
    </main>
  );
}
