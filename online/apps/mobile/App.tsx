import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  STAT_KEYS,
  buildLoginEmail,
  createNativeSupabaseClient,
  isStatTrainingTier,
  LOGIN_EMAIL_CUSTOM,
  LOGIN_EMAIL_DOMAIN_SUFFIXES,
  mapVisibleStatLabel,
  nextTrainingTier,
  parseLoginEmail,
  pushRecentLoginEmail,
  RECENT_LOGIN_EMAILS_KEY,
  rpcJoinMatchByCode,
  rpcLeaveMatchPresence,
  rpcPingMatchPresence,
  rpcPurchaseNextStatTraining,
  rpcRespondMatchInvite,
  rpcSetPlayerActiveCharacterForMatch,
  rpcSubmitCheckResponse,
  tokenCostForNextTier,
  trainingTierLongLabelEs,
} from "@dxd/shared";
import type { ExplosionSegment, StatKey, StatTrainingTier } from "@dxd/shared";
import { Audio } from "expo-av";
import Constants from "expo-constants";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlayerTableScreen } from "./components/PlayerTableScreen";
import { pickAndPreparePortraitJpeg, uploadPortraitJpeg } from "./lib/characterAvatarUpload";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Modal,
  Image,
  KeyboardAvoidingView,
  LogBox,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { AppStateStatus } from "react-native";

type Props = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

/** Coincide con el enum `die_size` en Postgres (no hay d2 en esta versión online). */
const DICE_SIZES = ["4", "6", "8", "10", "12", "20"] as const;
const CREATE_TRAINING_TIERS: readonly StatTrainingTier[] = ["trained_in", "studied_in", "master_in"];
const CREATE_TRAINING_TIER_SHORT_LABEL: Record<StatTrainingTier, string> = {
  none: "SE",
  trained_in: "TI",
  studied_in: "SI",
  master_in: "MI",
};
const CHECK_SOUND_ASSET = require("./assets/sounds/HXH Notificacion.mp3");
const CHECK_SOUND_FILENAME = "HXH Notificacion.mp3";
const CHECK_NOTIFICATION_CHANNEL_ID = "incoming-check-alerts";
const IS_EXPO_GO =
  Constants.executionEnvironment === "storeClient" || Constants.appOwnership === "expo";
const ENABLE_NOTIFICATIONS = !IS_EXPO_GO;
const NotificationsModule: typeof import("expo-notifications") | null = ENABLE_NOTIFICATIONS
  ? (require("expo-notifications") as typeof import("expo-notifications"))
  : null;

// Cuando queda un refresh token viejo en storage, GoTrue puede loguear este error
// durante la recuperación automática. Nosotros lo limpiamos y cerramos sesión local.
LogBox.ignoreLogs(["AuthApiError: Invalid Refresh Token: Refresh Token Not Found"]);

if (NotificationsModule) {
  NotificationsModule.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

function initialStatDice(): Record<StatKey, string> {
  return Object.fromEntries(STAT_KEYS.map((k) => [k, "20"])) as Record<StatKey, string>;
}

function initialStatTraining(): Record<StatKey, StatTrainingTier> {
  return Object.fromEntries(STAT_KEYS.map((k) => [k, "none" as StatTrainingTier])) as Record<StatKey, StatTrainingTier>;
}

function trainingTierFromDb(raw: unknown): StatTrainingTier {
  const s = typeof raw === "string" ? raw : "";
  return isStatTrainingTier(s) ? s : "none";
}

type PendingTarget = {
  check_id: string;
  character_id: string;
  checks: {
    check_value: number;
    stat_label_at_time: string;
    status: string;
    stat_key: string;
  } | null;
};

type PlayerScreen = "hub" | "table";

type LibraryChar = { id: string; name: string; avatar_url?: string | null };

type InviteRow = {
  id: string;
  match_id: string;
  invited_character_id: string | null;
  matches: { code: string; title: string } | { code: string; title: string }[] | null;
};

function matchFromInvite(row: InviteRow): { code: string; title: string } | null {
  const m = row.matches;
  if (!m) return null;
  if (Array.isArray(m)) return m[0] ?? null;
  return m;
}

/** PostgREST / Supabase a veces devuelven un objeto que no es `Error` → evita `[object Object]` en Alert. */
function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e !== null && typeof e === "object") {
    const o = e as Record<string, unknown>;
    if (typeof o.message === "string" && o.message.length > 0) return o.message;
    if (typeof o.error_description === "string") return o.error_description;
    if (typeof o.msg === "string") return o.msg;
    try {
      return JSON.stringify(o);
    } catch {
      return "Error desconocido";
    }
  }
  return String(e);
}

function isInvalidRefreshTokenError(e: unknown): boolean {
  const msg = errorMessage(e).toLowerCase();
  return msg.includes("invalid refresh token") || msg.includes("refresh token not found");
}

function remoteImageUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  return /^https?:\/\//i.test(t) ? t : null;
}

/** Misma estética que master-web y mesa: negro + #66ff66. */
const C = {
  bg: "#000000",
  panel: "#0a0a0a",
  panel2: "#101010",
  line: "#66ff66",
  lineDim: "rgba(102, 255, 102, 0.42)",
  lineSoft: "rgba(102, 255, 102, 0.24)",
  lineFaint: "rgba(102, 255, 102, 0.14)",
  text: "#d9ffd9",
  textMuted: "rgba(102, 255, 102, 0.68)",
  warn: "#facc15",
} as const;

const PLACEHOLDER = "rgba(102, 255, 102, 0.42)";

export default function App() {
  const url = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? "").trim();
  const anonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

  if (!url || !anonKey) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Falta configuración</Text>
        <Text style={styles.muted}>
          En apps/mobile/.env.local definí EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_ANON_KEY (los
          mismos valores que en master-web, con prefijo EXPO_PUBLIC_). Guardá el archivo y reiniciá Expo
          desde esta carpeta (apps/mobile), p. ej. npm run start o npm run dev:mobile desde online/.
        </Text>
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <>
      <AppInner supabaseUrl={url} supabaseAnonKey={anonKey} />
      <StatusBar style="light" />
    </>
  );
}

function AppInner({ supabaseUrl, supabaseAnonKey }: Props) {
  const supabase = useMemo(
    () =>
      createNativeSupabaseClient({
        supabaseUrl,
        supabaseAnonKey,
        auth: { storage: AsyncStorage },
      }),
    [supabaseUrl, supabaseAnonKey],
  );

  const [emailLocal, setEmailLocal] = useState("");
  const [emailDomainChoice, setEmailDomainChoice] = useState<string>(LOGIN_EMAIL_DOMAIN_SUFFIXES[0] ?? "@gmail.com");
  const [emailCustomDomain, setEmailCustomDomain] = useState("");
  const [domainDropdownOpen, setDomainDropdownOpen] = useState(false);
  const [loginUseFullEmail, setLoginUseFullEmail] = useState(false);
  const [fullEmailDirect, setFullEmailDirect] = useState("");
  const [recentEmails, setRecentEmails] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const lastNotifiedCheckIdRef = useRef<string | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const notificationsReadyRef = useRef(false);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  /** `false` mientras corre el bootstrap inicial o un reintento de `getSession`. */
  const [authReady, setAuthReady] = useState(false);
  /** Error de red/AsyncStorage al leer sesión (no confundir con «no hay usuario»). */
  const [sessionBootstrapError, setSessionBootstrapError] = useState<string | null>(null);
  const [bootstrapNonce, setBootstrapNonce] = useState(0);

  const [screen, setScreen] = useState<PlayerScreen>("hub");
  const [libraryChars, setLibraryChars] = useState<LibraryChar[]>([]);
  const [libraryPage, setLibraryPage] = useState(0);
  /** Modo edición: muestra el botón "−" para archivar con confirmación. */
  const [invites, setInvites] = useState<InviteRow[]>([]);

  const [joinCode, setJoinCode] = useState("");
  const [joinSelectedCharId, setJoinSelectedCharId] = useState("");
  /** Tras aceptar invitación sin personaje fijo: ya sos miembro, solo falta elegir hoja. */
  const [skipJoinRpc, setSkipJoinRpc] = useState(false);

  const [lastMatchId, setLastMatchId] = useState<string | null>(null);
  const [activeCharacterId, setActiveCharacterId] = useState<string | null>(null);
  const [activeCharacterLabel, setActiveCharacterLabel] = useState("");

  const [characterName, setCharacterName] = useState("");
  /** Imagen local ya recortada/redimensionada a JPEG (512×512); al guardar se sube a Storage. */
  const [pendingCreatePortraitUri, setPendingCreatePortraitUri] = useState<string | null>(null);
  const [statDice, setStatDice] = useState<Record<StatKey, string>>(initialStatDice);
  const [createStatTraining, setCreateStatTraining] = useState<Record<StatKey, StatTrainingTier>>(initialStatTraining);
  const [editCharacterTab, setEditCharacterTab] = useState<"datos" | "progresos">("datos");
  const [editStatTraining, setEditStatTraining] = useState<Record<StatKey, StatTrainingTier>>(initialStatTraining);
  const [chapterUpgradesOpen, setChapterUpgradesOpen] = useState(false);
  const [buyingTrainingKey, setBuyingTrainingKey] = useState<StatKey | null>(null);
  const [pending, setPending] = useState<PendingTarget | null>(null);
  /** Checks con `checks.status === open` y `response_status === pending` (cola para este personaje). */
  const [pendingOpenChecksCount, setPendingOpenChecksCount] = useState(0);
  const [pendingOpenChecks, setPendingOpenChecks] = useState<PendingTarget[]>([]);
  const [tableSheetTick, setTableSheetTick] = useState(0);
  const [editingCharacterId, setEditingCharacterId] = useState<string | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editCharName, setEditCharName] = useState("");
  const [editCharAvatar, setEditCharAvatar] = useState("");
  const [pendingEditPortraitUri, setPendingEditPortraitUri] = useState<string | null>(null);
  const [rollValue, setRollValue] = useState("");
  const [tokensSpent, setTokensSpent] = useState("0");
  const [invitesModalOpen, setInvitesModalOpen] = useState(false);

  const resetUiAfterSignOut = useCallback(() => {
    setScreen("hub");
    setLibraryChars([]);
    setInvites([]);
    setJoinCode("");
    setJoinSelectedCharId("");
    setSkipJoinRpc(false);
    setLastMatchId(null);
    setActiveCharacterId(null);
    setActiveCharacterLabel("");
    setPending(null);
    setPendingOpenChecksCount(0);
    setPendingOpenChecks([]);
    setStatDice(initialStatDice());
    setCreateStatTraining(initialStatTraining());
    setEditModalOpen(false);
    setCreateModalOpen(false);
    setEditingCharacterId(null);
  }, []);

  /** Listener global: debe vivir todo el ciclo de vida del cliente (docs Supabase). */
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSessionEmail(session?.user.email ?? null);
      setMyUserId(session?.user.id ?? null);
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  /**
   * En React Native el SDK no usa `visibilitychange`; hay que acoplar el auto-refresh al
   * ciclo de vida de la app. Si el ticker sigue en segundo plano con red suspendida, el
   * refresh puede fallar con error no reintentable y borrar la sesión (`SIGNED_OUT`).
   * @see https://supabase.com/docs/reference/javascript/auth-startautorefresh
   */
  useEffect(() => {
    const syncRefreshToAppState = (state: string) => {
      appStateRef.current = state as AppStateStatus;
      if (state === "active") {
        void (async () => {
          try {
            const { data } = await supabase.auth.getSession();
            if (!data.session) return;
            void supabase.auth.startAutoRefresh();
          } catch (e: unknown) {
            if (!isInvalidRefreshTokenError(e)) return;
            try {
              await supabase.auth.signOut({ scope: "local" });
            } catch {
              /* ignore cleanup errors */
            }
            setSessionEmail(null);
            setMyUserId(null);
            resetUiAfterSignOut();
          }
        })();
      } else {
        void supabase.auth.stopAutoRefresh();
      }
    };
    const sub = AppState.addEventListener("change", syncRefreshToAppState);
    syncRefreshToAppState(AppState.currentState);
    return () => {
      sub.remove();
    };
  }, [resetUiAfterSignOut, supabase]);

  useEffect(() => {
    if (IS_EXPO_GO || !ENABLE_NOTIFICATIONS) {
      notificationsReadyRef.current = false;
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        if (!NotificationsModule) return;
        const { status } = await NotificationsModule.requestPermissionsAsync();
        if (cancelled || status !== "granted") return;
        if (Platform.OS === "android") {
          await NotificationsModule.setNotificationChannelAsync(CHECK_NOTIFICATION_CHANNEL_ID, {
            name: "Checks entrantes",
            importance: NotificationsModule.AndroidImportance.HIGH,
            sound: CHECK_SOUND_FILENAME,
            vibrationPattern: [0, 200, 120, 200],
          });
        }
        notificationsReadyRef.current = true;
      } catch {
        notificationsReadyRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const maxAttempts = 4;
    setAuthReady(false);
    void (async () => {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const { data } = await supabase.auth.getSession();
          if (cancelled) return;
          setSessionEmail(data.session?.user.email ?? null);
          setMyUserId(data.session?.user.id ?? null);
          setSessionBootstrapError(null);
          setAuthReady(true);
          return;
        } catch (e: unknown) {
          if (cancelled) return;
          if (isInvalidRefreshTokenError(e)) {
            await supabase.auth.signOut({ scope: "local" });
            if (cancelled) return;
            setSessionEmail(null);
            setMyUserId(null);
            resetUiAfterSignOut();
            setSessionBootstrapError(null);
            setAuthReady(true);
            return;
          }
          if (attempt < maxAttempts - 1) {
            await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
            continue;
          }
          setSessionBootstrapError(errorMessage(e));
          setAuthReady(true);
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bootstrapNonce, resetUiAfterSignOut, supabase]);

  useEffect(() => {
    if (screen !== "table" || !lastMatchId) return;
    const mid = lastMatchId;
    const ping = () => {
      void rpcPingMatchPresence(supabase, { matchId: mid }).catch(() => {});
    };
    const leave = () => {
      void rpcLeaveMatchPresence(supabase, { matchId: mid }).catch(() => {});
    };
    ping();
    const interval = setInterval(ping, 25_000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") ping();
      else if (state === "background" || state === "inactive") leave();
    });
    return () => {
      leave();
      clearInterval(interval);
      sub.remove();
    };
  }, [lastMatchId, screen, supabase]);

  const loadLibrary = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) return;
    const { data, error } = await supabase
      .from("characters")
      .select("id, name, avatar_url")
      .eq("owner_user_id", uid)
      .eq("is_archived", false)
      .order("created_at", { ascending: false });
    if (error) {
      console.warn("loadLibrary", error.message);
      return;
    }
    setLibraryChars(
      ((data ?? []) as LibraryChar[]).map((r) => ({ id: r.id, name: r.name, avatar_url: r.avatar_url ?? null })),
    );
  }, [supabase]);

  /** Personajes propios más PET concedidos (`characters.origin = master_pet` + match_characters) para esa mesa. */
  const loadSelectableCharactersForMatch = useCallback(
    async (matchId: string): Promise<LibraryChar[]> => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) return [];

      const { data: owned, error: ownedErr } = await supabase
        .from("characters")
        .select("id, name, avatar_url")
        .eq("owner_user_id", uid)
        .eq("is_archived", false)
        .order("created_at", { ascending: false });

      const ownedRows: LibraryChar[] = !ownedErr
        ? (((owned ?? []) as LibraryChar[]) ?? []).map((r) => ({
            id: r.id,
            name: r.name,
            avatar_url: r.avatar_url ?? null,
          }))
        : [];

      const { data: mcRows, error: mcErr } = await supabase
        .from("match_characters")
        .select("character_id")
        .eq("match_id", matchId)
        .eq("user_id", uid)
        .eq("is_active", true);

      if (mcErr || !mcRows?.length) {
        return ownedRows;
      }

      const petCandidateIds = Array.from(
        new Set(mcRows.map((r) => String(r.character_id ?? "").trim()).filter(Boolean)),
      );
      const { data: petChars, error: petErr } = await supabase
        .from("characters")
        .select("id, name, avatar_url")
        .in("id", petCandidateIds)
        .eq("origin", "master_pet")
        .eq("is_archived", false);

      if (petErr) {
        return ownedRows;
      }

      const petRows: LibraryChar[] = (((petChars ?? []) as LibraryChar[]) ?? []).map((r) => ({
        id: r.id,
        name: `[PET] ${r.name}`,
        avatar_url: r.avatar_url ?? null,
      }));

      const byId = new Map<string, LibraryChar>();
      for (const row of [...petRows, ...ownedRows]) {
        if (!byId.has(row.id)) byId.set(row.id, row);
      }
      return [...byId.values()];
    },
    [supabase],
  );

  const loadInvites = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) return;
    const { data, error } = await supabase
      .from("match_invites")
      .select("id, match_id, invited_character_id, matches(code, title)")
      .eq("invited_user_id", uid)
      .eq("status", "pending");
    if (error) {
      if (error.message.includes("does not exist") || error.code === "42P01") {
        setInvites([]);
        return;
      }
      // Fallback: algunas combinaciones de RLS rompen el embed `matches(...)`.
      const { data: d2, error: e2 } = await supabase
        .from("match_invites")
        .select("id, match_id, invited_character_id")
        .eq("invited_user_id", uid)
        .eq("status", "pending");
      if (e2) {
        console.warn("loadInvites", error.message, e2.message);
        return;
      }
      setInvites(
        ((d2 ?? []) as Array<{ id: string; match_id: string; invited_character_id: string | null }>).map((r) => ({
          ...r,
          matches: null,
        })),
      );
      return;
    }
    setInvites((data ?? []) as InviteRow[]);
  }, [supabase]);

  useEffect(() => {
    if (!myUserId) return;
    const channel = supabase
      .channel(`player-invites-${myUserId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "match_invites",
          filter: `invited_user_id=eq.${myUserId}`,
        },
        () => {
          void loadInvites();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadInvites, myUserId, supabase]);

  useEffect(() => {
    if (!invitesModalOpen || !myUserId) return;
    void loadInvites();
    const timer = setInterval(() => {
      void loadInvites();
    }, 2500);
    return () => clearInterval(timer);
  }, [invitesModalOpen, loadInvites, myUserId]);

  const archiveCharacterNow = useCallback(
    async (c: LibraryChar) => {
      setBusy(true);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const uid = sessionData.session?.user.id;
        if (!uid) throw new Error("Sin sesión.");

        const { data, error } = await supabase
          .from("characters")
          .update({ is_archived: true })
          .eq("id", c.id)
          .eq("owner_user_id", uid)
          .select("id")
          .maybeSingle();

        if (error) throw error;
        if (!data?.id) {
          throw new Error(
            "No se actualizó ninguna fila (¿RLS o el personaje ya estaba archivado?). Revisá en Supabase que exista la policy de UPDATE para `characters` del dueño.",
          );
        }

        setJoinSelectedCharId((prev) => (prev === c.id ? "" : prev));
        setEditingCharacterId((prev) => {
          if (prev === c.id) {
            setEditModalOpen(false);
            return null;
          }
          return prev;
        });
        await loadLibrary();
        setTimeout(() => {
          Alert.alert("Listo", "Personaje archivado.");
        }, 250);
      } catch (e: unknown) {
        Alert.alert("No se pudo archivar", errorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [loadLibrary, supabase],
  );

  const confirmArchiveCharacter = useCallback(
    (c: LibraryChar) => {
      Alert.alert(
        "¿Quitar este personaje?",
        `«${c.name}» dejará de aparecer en tu lista (se archiva en el servidor; no se borra de golpe si hubo partidas).`,
        [
          { text: "No", style: "cancel" },
          {
            text: "Sí, quitar",
            style: "destructive",
            onPress: () => {
              void archiveCharacterNow(c);
            },
          },
        ],
      );
    },
    [archiveCharacterNow],
  );

  useEffect(() => {
    if (!myUserId) return;
    void loadLibrary();
    void loadInvites();
  }, [myUserId, loadLibrary, loadInvites]);

  /** En el hub, si no hay selección o el id ya no existe, elegimos el primer personaje de la biblioteca. */
  useEffect(() => {
    if (screen !== "hub") return;
    if (libraryChars.length === 0) return;
    setJoinSelectedCharId((prev) => {
      if (prev && libraryChars.some((c) => c.id === prev)) return prev;
      return libraryChars[0].id;
    });
  }, [screen, libraryChars]);

  /** Grilla 4×4 (16 celdas); +1 celda en hub para «Crear». Orden por columnas (A1–A4, B1–B4, …). */
  const LIB_GRID_SIZE = 16;
  const libraryPages = Math.max(1, Math.ceil((libraryChars.length + 1) / LIB_GRID_SIZE));
  const safeLibraryPage = Math.min(libraryPage, libraryPages - 1);

  useEffect(() => {
    void AsyncStorage.getItem(RECENT_LOGIN_EMAILS_KEY).then((raw) => {
      if (!raw) return;
      try {
        const arr = JSON.parse(raw) as unknown;
        if (Array.isArray(arr)) {
          setRecentEmails(arr.filter((x): x is string => typeof x === "string").slice(0, 8));
        }
      } catch {
        /* ignore */
      }
    });
  }, []);

  const signIn = useCallback(async () => {
    const resolved = loginUseFullEmail
      ? fullEmailDirect.trim()
      : buildLoginEmail({
          localPart: emailLocal,
          domainChoice: emailDomainChoice,
          customDomain: emailCustomDomain,
        });
    if (!resolved || !resolved.includes("@")) {
      Alert.alert("Email", "Completá un email válido (nombre + dominio o modo completo).");
      return;
    }
    if (emailDomainChoice === LOGIN_EMAIL_CUSTOM && !loginUseFullEmail && !emailCustomDomain.trim()) {
      Alert.alert("Dominio", 'Escribí el dominio después de "@" (ej. empresa.com) o usá otro preset.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: resolved, password });
      if (error) throw error;
      setRecentEmails((prev) => {
        const next = pushRecentLoginEmail(prev, resolved);
        void AsyncStorage.setItem(RECENT_LOGIN_EMAILS_KEY, JSON.stringify(next));
        return next;
      });
      setScreen("hub");
    } catch (e: unknown) {
      Alert.alert("Error", errorMessage(e));
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

  const signInAnonymous = useCallback(async () => {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      setScreen("hub");
    } catch (e: unknown) {
      Alert.alert(
        "Sesión anónima",
        `${errorMessage(e)}\n\nEn Supabase: Authentication → Providers → Anonymous → habilitar «Enable Anonymous sign-ins».`,
      );
    } finally {
      setBusy(false);
    }
  }, [supabase]);

  const signOut = useCallback(async () => {
    setBusy(true);
    try {
      const mid = lastMatchId?.trim();
      if (mid) {
        try {
          await rpcLeaveMatchPresence(supabase, { matchId: mid });
        } catch {
          /* sin RPC o sin red: igual cerramos sesión */
        }
      }
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      resetUiAfterSignOut();
    } catch (e: unknown) {
      Alert.alert("Error", errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [lastMatchId, resetUiAfterSignOut, supabase]);

  const bumpStatDie = useCallback((key: StatKey, delta: number) => {
    setStatDice((prev) => {
      const cur = prev[key];
      const i = DICE_SIZES.indexOf(cur as (typeof DICE_SIZES)[number]);
      const idx = (Math.max(0, i) + delta + DICE_SIZES.length) % DICE_SIZES.length;
      return { ...prev, [key]: DICE_SIZES[idx] };
    });
  }, []);

  const createMinimalCharacter = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) {
      Alert.alert("Sesión", "No hay usuario.");
      return;
    }
    setBusy(true);
    try {
      const name = characterName.trim() || "Sin nombre";
      const { data: ch, error: e1 } = await supabase
        .from("characters")
        .insert({ name, owner_user_id: uid, avatar_url: null })
        .select("id")
        .single();
      if (e1) throw e1;
      if (!ch) throw new Error("Sin personaje");

      if (pendingCreatePortraitUri) {
        const publicUrl = await uploadPortraitJpeg(supabase, uid, ch.id, pendingCreatePortraitUri);
        const { error: eu } = await supabase.from("characters").update({ avatar_url: publicUrl }).eq("id", ch.id);
        if (eu) throw eu;
      }

      const statsRows = STAT_KEYS.map((k) => ({
        character_id: ch.id,
        stat_key: k,
        stat_label: mapVisibleStatLabel(k, null),
        die_size: statDice[k],
        base_modifier: 0,
        training_tier: createStatTraining[k],
      }));
      const { error: e2 } = await supabase.from("character_stats").insert(statsRows);
      if (e2) throw e2;

      const { error: e3 } = await supabase
        .from("character_resources")
        .insert({ character_id: ch.id, starting_tokens: 5, notes: "app" });
      if (e3) throw e3;

      await loadLibrary();
      const statsSummary = STAT_KEYS.map(
        (k) => `${mapVisibleStatLabel(k, null)}: d${statDice[k]}`,
      ).join("\n");
      Alert.alert("Personaje creado", `${name}\n\n${statsSummary}\n\nQuedó en tu biblioteca.`);
      setCharacterName("");
      setPendingCreatePortraitUri(null);
      setStatDice(initialStatDice());
      setCreateStatTraining(initialStatTraining());
      setJoinSelectedCharId(ch.id);
      setCreateModalOpen(false);
    } catch (e: unknown) {
      Alert.alert("Error", errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [
    characterName,
    createStatTraining,
    loadLibrary,
    pendingCreatePortraitUri,
    statDice,
    supabase,
  ]);

  const persistAndGoToTable = useCallback(
    async (matchId: string, charId: string, displayLabel?: string | null): Promise<boolean> => {
      try {
        await rpcSetPlayerActiveCharacterForMatch(supabase, { matchId, characterId: charId });
      } catch (e: unknown) {
        const msg = errorMessage(e);
        Alert.alert(
          "Partida",
          `${msg}\n\nSi falta una RPC o ves not_a_player_in_match / not_a_member_in_match: en Supabase → SQL Editor, en orden:\n1) 20260416120000_match_member_active_character.sql\n2) 20260418100000_active_character_allow_master.sql\n3) 20260501180000_character_origin_npc_pet.sql (PET cedidos)\n\n15200000 es unirse por código/UUID.`,
        );
        return false;
      }
      const trimmed = displayLabel?.trim();
      const label =
        trimmed && trimmed.length > 0 ? trimmed : (libraryChars.find((c) => c.id === charId)?.name ?? "Personaje");
      setLastMatchId(matchId);
      setActiveCharacterId(charId);
      setActiveCharacterLabel(label);
      setPending(null);
      setPendingOpenChecksCount(0);
      setSkipJoinRpc(false);
      setScreen("table");
      return true;
    },
    [libraryChars, supabase],
  );

  const doJoinMatch = useCallback(async () => {
    const trimmed = joinCode.trim();
    const cid = joinSelectedCharId.trim();
    if (!cid) {
      Alert.alert("Personaje", "Elegí un personaje de tu biblioteca (o creá uno nuevo).");
      return;
    }
    if (skipJoinRpc) {
      const mid = lastMatchId?.trim();
      if (!mid) {
        Alert.alert("Partida", "Algo salió mal: no hay partida activa.");
        return;
      }
      setBusy(true);
      try {
        const selectable = await loadSelectableCharactersForMatch(mid);
        if (selectable.length === 0) {
          Alert.alert("Personaje", "No tenés hojas elegibles para esta mesa (PJ archivados o sin PET cedido).");
          return;
        }
        let resolvedId = cid;
        if (!selectable.some((c) => c.id === resolvedId)) {
          resolvedId = selectable[0].id;
        }
        const resolvedLabel = selectable.find((c) => c.id === resolvedId)?.name ?? "Personaje";
        const ok = await persistAndGoToTable(mid, resolvedId, resolvedLabel);
        if (ok) {
          Alert.alert("Listo", `Vas a la mesa como «${resolvedLabel}».`);
          setJoinSelectedCharId(resolvedId);
        }
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!trimmed) {
      Alert.alert("Partida", "Ingresá el código corto o el ID (UUID) de la partida.");
      return;
    }
    setBusy(true);
    try {
      const { matchId } = await rpcJoinMatchByCode(supabase, trimmed);
      const selectable = await loadSelectableCharactersForMatch(matchId);
      if (selectable.length === 0) {
        Alert.alert("Personaje", "No hay personajes disponibles: creá un PJ propio o pedile al director que te ceda un PET.");
        return;
      }
      let resolvedId = cid;
      if (!selectable.some((c) => c.id === resolvedId)) {
        resolvedId = selectable[0].id;
      }
      const resolvedLabel = selectable.find((c) => c.id === resolvedId)?.name ?? "Personaje";
      const ok = await persistAndGoToTable(matchId, resolvedId, resolvedLabel);
      if (ok) {
        Alert.alert("Listo", `Entraste a la partida como «${resolvedLabel}».`);
        setJoinSelectedCharId(resolvedId);
      }
    } catch (e: unknown) {
      Alert.alert("No se pudo unir", errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [
    joinCode,
    joinSelectedCharId,
    lastMatchId,
    loadSelectableCharactersForMatch,
    persistAndGoToTable,
    skipJoinRpc,
    supabase,
  ]);

  const respondInvite = useCallback(
    async (row: InviteRow, accept: boolean) => {
      setBusy(true);
      try {
        await rpcRespondMatchInvite(supabase, { inviteId: row.id, accept });
        if (accept) {
          const m = matchFromInvite(row);
          const code = m?.code?.trim() || row.match_id;
          setInvitesModalOpen(false);
          setSkipJoinRpc(false);
          setLastMatchId(null);
          setJoinCode(code);
          if (libraryChars.length > 0) setJoinSelectedCharId(libraryChars[0].id);
          setScreen("hub");
          Alert.alert("Código cargado, selecciona personaje y unete a la partida.");
        }
        await loadInvites();
      } catch (e: unknown) {
        Alert.alert("Invitación", errorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [libraryChars, loadInvites, supabase],
  );

  const leaveTable = useCallback(async () => {
    const mid = lastMatchId?.trim();
    if (mid) {
      try {
        await rpcLeaveMatchPresence(supabase, { matchId: mid });
      } catch {
        /* sin RPC o sin red: igual volvemos al menú */
      }
    }
    setLastMatchId(null);
    setActiveCharacterId(null);
    setActiveCharacterLabel("");
    setPending(null);
    setPendingOpenChecksCount(0);
    setPendingOpenChecks([]);
    setSkipJoinRpc(false);
    setScreen("hub");
    void loadInvites();
  }, [lastMatchId, loadInvites, supabase]);

  const refreshPendingCheck = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid || !activeCharacterId) return;
    if (!silent) setBusy(true);
    try {
      const { data, error } = await supabase
        .from("check_targets")
        .select("check_id, character_id, checks(check_value, stat_label_at_time, status, stat_key)")
        .eq("user_id", uid)
        .eq("character_id", activeCharacterId)
        .eq("response_status", "pending")
        .order("created_at", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as unknown as PendingTarget[];
      const openRows = rows.filter((r) => r.checks?.status === "open");
      setPendingOpenChecks(openRows);
      setPendingOpenChecksCount(openRows.length);
      setPending(openRows[0] ?? null);
      if (!silent && openRows.length === 0 && rows.length > 0) {
        Alert.alert("Checks", "No hay checks abiertos para este personaje.");
      }
    } catch (e: unknown) {
      if (!silent) {
        Alert.alert("Error", errorMessage(e));
      }
    } finally {
      if (!silent) setBusy(false);
    }
  }, [activeCharacterId, supabase]);

  const matchChapterOpenRef = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    matchChapterOpenRef.current = undefined;
  }, [lastMatchId]);

  useEffect(() => {
    if (screen !== "table" || !activeCharacterId) return;
    let cancelled = false;
    let inFlight = false;
    const run = async () => {
      if (cancelled || inFlight) return;
      if (appStateRef.current !== "active") return;
      inFlight = true;
      try {
        await refreshPendingCheck({ silent: true });
        if (cancelled || !lastMatchId) return;
        const { data: mRow, error: me } = await supabase
          .from("matches")
          .select("chapter_upgrades_open")
          .eq("id", lastMatchId)
          .maybeSingle();
        if (cancelled || me) return;
        const open = Boolean(mRow?.chapter_upgrades_open);
        const prev = matchChapterOpenRef.current;
        if (prev === undefined) {
          matchChapterOpenRef.current = open;
        } else if (prev !== open) {
          matchChapterOpenRef.current = open;
          setTableSheetTick((n) => n + 1);
        }
      } catch {
        /* en segundo plano o con túnel inestable pueden fallar fetches transitorios */
      } finally {
        inFlight = false;
      }
    };
    void run();
    const t = setInterval(() => {
      void run();
    }, 2500);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [activeCharacterId, lastMatchId, refreshPendingCheck, screen, supabase]);

  /** Al terminar capítulo el master actualiza `matches`; refrescamos la hoja de mesa al instante. */
  useEffect(() => {
    if (screen !== "table" || !lastMatchId) return;
    const channel = supabase
      .channel(`player-match-${lastMatchId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "matches", filter: `id=eq.${lastMatchId}` },
        () => {
          setTableSheetTick((n) => n + 1);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "character_runtime",
          filter: `match_id=eq.${lastMatchId}`,
        },
        () => {
          setTableSheetTick((n) => n + 1);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [lastMatchId, screen, supabase]);

  const submitResponse = useCallback(
    async (roll: number, tokens: number, modifier: number, userComment?: string, explosionSteps?: ExplosionSegment[]) => {
      if (!pending?.checks || !lastMatchId) return;
      if (!Number.isFinite(roll) || !Number.isFinite(tokens) || !Number.isFinite(modifier)) {
        Alert.alert("Check", "Valores inválidos.");
        return;
      }
      setBusy(true);
      try {
        // Reasegura asignación activa antes de enviar (evita desincronización match_characters).
        await rpcSetPlayerActiveCharacterForMatch(supabase, {
          matchId: lastMatchId,
          characterId: pending.character_id,
        });
        let res;
        try {
          res = await rpcSubmitCheckResponse(supabase, {
            checkId: pending.check_id,
            characterId: pending.character_id,
            rollValue: roll,
            tokensSpent: tokens,
            modifierApplied: modifier,
            userComment: userComment ?? null,
            explosionMode: "desktop",
            explosionSteps: explosionSteps ?? [],
          });
        } catch (e: unknown) {
          const msg = errorMessage(e);
          if (!msg.includes("character_not_assigned")) throw e;
          // Reintento único tras reasignar.
          await rpcSetPlayerActiveCharacterForMatch(supabase, {
            matchId: lastMatchId,
            characterId: pending.character_id,
          });
          res = await rpcSubmitCheckResponse(supabase, {
            checkId: pending.check_id,
            characterId: pending.character_id,
            rollValue: roll,
            tokensSpent: tokens,
            modifierApplied: modifier,
            userComment: userComment ?? null,
            explosionMode: "desktop",
            explosionSteps: explosionSteps ?? [],
          });
        }
        setRollValue("");
        setTokensSpent("0");
        setTableSheetTick((n) => n + 1);
        await refreshPendingCheck({ silent: true });
        Alert.alert("Check", "Resultado enviado.");
      } catch (e: unknown) {
        Alert.alert("Error", errorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [lastMatchId, pending, refreshPendingCheck, supabase],
  );

  /** Nuevo check pendiente: vaciar tirada y volver fichas a 0. */
  useEffect(() => {
    const id = pending?.check_id;
    if (!id) return;
    setRollValue("");
    setTokensSpent("0");
    if (lastNotifiedCheckIdRef.current === id) return;
    lastNotifiedCheckIdRef.current = id;
    void (async () => {
      const isForeground = appStateRef.current === "active";
      try {
        if (isForeground) {
          await Audio.setAudioModeAsync({
            playsInSilentModeIOS: true,
            shouldDuckAndroid: true,
          });
          const { sound } = await Audio.Sound.createAsync(
            CHECK_SOUND_ASSET,
            { shouldPlay: true, volume: 0.9 },
          );
          sound.setOnPlaybackStatusUpdate((status) => {
            if (!status.isLoaded) return;
            if (status.didJustFinish) void sound.unloadAsync();
          });
          return;
        }

        if (IS_EXPO_GO || !ENABLE_NOTIFICATIONS || !notificationsReadyRef.current || !NotificationsModule) return;
        const userLabel = sessionEmail?.split("@")[0]?.trim() || myUserId?.slice(0, 8) || "Usuario";
        const characterLabel = activeCharacterLabel.trim() || "Personaje";
        await NotificationsModule.scheduleNotificationAsync({
          content: {
            title: `${userLabel}`,
            body: `${characterLabel} tiene un check`,
            sound: CHECK_SOUND_FILENAME,
            data: { type: "incoming_check", checkId: id, userLabel, characterLabel },
          },
          trigger: null,
        });
      } catch {
        /* no-op: sonido opcional */
      }
    })();
  }, [activeCharacterLabel, myUserId, pending?.check_id, sessionEmail]);

  useEffect(() => {
    if (!editModalOpen || !editingCharacterId) return;
    setPendingEditPortraitUri(null);
    setEditCharacterTab("datos");
    let cancelled = false;
    void (async () => {
      const { data: chRow, error: e1 } = await supabase
        .from("characters")
        .select("name, avatar_url")
        .eq("id", editingCharacterId)
        .single();
      if (cancelled) return;
      if (e1) {
        Alert.alert("Error", e1.message);
        return;
      }
      if (chRow) {
        setEditCharName(String(chRow.name ?? ""));
        const av = typeof chRow.avatar_url === "string" ? chRow.avatar_url.trim() : "";
        setEditCharAvatar(av);
      }
      const { data: stRows, error: e2 } = await supabase
        .from("character_stats")
        .select("stat_key, training_tier")
        .eq("character_id", editingCharacterId);
      if (cancelled) return;
      if (e2) {
        console.warn("character_stats", e2.message);
        setEditStatTraining(initialStatTraining());
        return;
      }
      const next = initialStatTraining();
      for (const row of stRows ?? []) {
        const k = row.stat_key as StatKey;
        if ((STAT_KEYS as readonly string[]).includes(k)) {
          next[k] = trainingTierFromDb(row.training_tier);
        }
      }
      setEditStatTraining(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [editingCharacterId, editModalOpen, supabase]);

  useEffect(() => {
    if (!editModalOpen || !lastMatchId) {
      setChapterUpgradesOpen(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("matches")
        .select("chapter_upgrades_open")
        .eq("id", lastMatchId)
        .maybeSingle();
      if (cancelled || error) return;
      setChapterUpgradesOpen(Boolean(data?.chapter_upgrades_open));
    })();
    return () => {
      cancelled = true;
    };
  }, [lastMatchId, editModalOpen, supabase]);

  const buyNextTraining = useCallback(
    async (statKey: StatKey) => {
      if (!editingCharacterId || !lastMatchId) {
        Alert.alert("Progresos", "Necesitás estar dentro de una partida activa.");
        return;
      }
      if (!chapterUpgradesOpen) {
        Alert.alert("Progresos", "El master todavía no terminó el capítulo.");
        return;
      }
      setBuyingTrainingKey(statKey);
      try {
        const res = await rpcPurchaseNextStatTraining(supabase, {
          matchId: lastMatchId,
          characterId: editingCharacterId,
          statKey,
        });
        const next = trainingTierFromDb(res.training_tier);
        setEditStatTraining((prev) => ({ ...prev, [statKey]: next }));
        Alert.alert(
          "Progreso comprado",
          `${mapVisibleStatLabel(statKey, null)} → ${trainingTierLongLabelEs(next)} (-${res.tokens_spent} fichas)`,
        );
      } catch (e: unknown) {
        Alert.alert("No se pudo comprar", errorMessage(e));
      } finally {
        setBuyingTrainingKey(null);
      }
    },
    [chapterUpgradesOpen, editingCharacterId, lastMatchId, supabase],
  );

  const saveEditCharacter = useCallback(async () => {
    if (!editingCharacterId) return;
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) {
      Alert.alert("Sesión", "No hay usuario.");
      return;
    }
    setBusy(true);
    try {
      const name = editCharName.trim() || "Sin nombre";
      let avatarUrl: string | null = editCharAvatar.trim() || null;
      if (pendingEditPortraitUri) {
        avatarUrl = await uploadPortraitJpeg(supabase, uid, editingCharacterId, pendingEditPortraitUri);
      }
      const { error } = await supabase
        .from("characters")
        .update({
          name,
          avatar_url: avatarUrl,
        })
        .eq("id", editingCharacterId);
      if (error) throw error;
      await loadLibrary();
      if (activeCharacterId === editingCharacterId) {
        setActiveCharacterLabel(name);
      }
      setTableSheetTick((n) => n + 1);
      setPendingEditPortraitUri(null);
      setEditingCharacterId(null);
      setEditModalOpen(false);
    } catch (e: unknown) {
      Alert.alert("Error", errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [
    activeCharacterId,
    editCharAvatar,
    editCharName,
    editingCharacterId,
    loadLibrary,
    pendingEditPortraitUri,
    supabase,
  ]);

  if (!authReady) {
    return (
      <View style={styles.center} accessibilityLabel="Cargando sesión">
        <ActivityIndicator size="large" color={C.line} />
        <Text style={[styles.muted, { marginTop: 16, textAlign: "center" }]}>Cargando sesión…</Text>
      </View>
    );
  }

  if (sessionBootstrapError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>No se pudo cargar la sesión</Text>
        <Text style={[styles.muted, { textAlign: "center", marginTop: 8 }]}>{sessionBootstrapError}</Text>
        <Text style={[styles.muted, { textAlign: "center", marginTop: 12, fontSize: 13 }]}>
          Reintentá con buena señal; no cerramos tu sesión por un fallo transitorio.
        </Text>
        <Pressable
          style={[styles.btn, { marginTop: 22, alignSelf: "stretch", maxWidth: 320 }]}
          onPress={() => setBootstrapNonce((n) => n + 1)}
        >
          <Text style={styles.btnText}>Reintentar</Text>
        </Pressable>
      </View>
    );
  }

  if (!myUserId) {
    return (
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.loginScreenScroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.loginTitle}>DXD — Jugador</Text>
          <Text style={styles.loginBoxTitle}>LOG IN</Text>

          <Text style={styles.label}>Nombre (sin @)</Text>

          <View style={styles.loginNameDomainRow}>
            <TextInput
              style={[styles.input, styles.loginLocalInput]}
              autoCapitalize="none"
              keyboardType="default"
              value={emailLocal}
              onChangeText={setEmailLocal}
              placeholder="ej. maria.perez"
              placeholderTextColor={PLACEHOLDER}
            />

            <Pressable
              style={styles.domainDropdownBtn}
              onPress={() => setDomainDropdownOpen(true)}
              disabled={busy}
              accessibilityLabel="Elegí dominio"
              accessibilityHint="Abrí el menú de dominios"
            >
              <Text style={styles.domainDropdownText}>
                @{emailDomainChoice === LOGIN_EMAIL_CUSTOM ? "Otro…" : emailDomainChoice.replace("@", "")}
              </Text>
            </Pressable>
          </View>

          <Modal
            visible={domainDropdownOpen}
            transparent
            animationType="fade"
            onRequestClose={() => setDomainDropdownOpen(false)}
          >
            <Pressable style={styles.dropdownOverlay} onPress={() => setDomainDropdownOpen(false)}>
              <View style={styles.dropdownSheet}>
                {LOGIN_EMAIL_DOMAIN_SUFFIXES.map((suffix) => {
                  const label = suffix.replace("@", "");
                  const on = emailDomainChoice === suffix;
                  return (
                    <Pressable
                      key={suffix}
                      style={[styles.dropdownItem, on && styles.dropdownItemOn]}
                      onPress={() => {
                        setEmailDomainChoice(suffix);
                        setDomainDropdownOpen(false);
                      }}
                    >
                      <Text style={[styles.dropdownItemText, on && styles.dropdownItemTextOn]}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
                <Pressable
                  style={[styles.dropdownItem, emailDomainChoice === LOGIN_EMAIL_CUSTOM && styles.dropdownItemOn]}
                  onPress={() => {
                    setEmailDomainChoice(LOGIN_EMAIL_CUSTOM);
                    setDomainDropdownOpen(false);
                  }}
                >
                  <Text
                    style={[
                      styles.dropdownItemText,
                      emailDomainChoice === LOGIN_EMAIL_CUSTOM && styles.dropdownItemTextOn,
                    ]}
                  >
                    Otro…
                  </Text>
                </Pressable>
              </View>
            </Pressable>
          </Modal>

          {emailDomainChoice === LOGIN_EMAIL_CUSTOM ? (
            <>
              <Text style={styles.muted}>Dominio solo (sin @): se arma nombre@dominio</Text>
              <TextInput
                style={styles.input}
                autoCapitalize="none"
                value={emailCustomDomain}
                onChangeText={setEmailCustomDomain}
                placeholder="ej. outlook.com.ar"
                placeholderTextColor={PLACEHOLDER}
              />
            </>
          ) : null}

          <Text style={styles.label}>Contraseña</Text>
          <TextInput
            style={styles.input}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            placeholder="••••••"
            placeholderTextColor={PLACEHOLDER}
          />

          {recentEmails.length > 0 ? (
            <>
              <Text style={styles.label}>Usados recientemente</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.domainScroll}>
                {recentEmails.map((em) => (
                  <Pressable
                    key={em}
                    style={styles.recentChip}
                    onPress={() => {
                      const p = parseLoginEmail(em);
                      setEmailLocal(p.localPart);
                      setEmailDomainChoice(p.domainChoice);
                      setEmailCustomDomain(p.customDomain);
                    }}
                  >
                    <Text style={styles.recentChipText} numberOfLines={1}>
                      {em}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          ) : null}

          <View style={styles.loginActionsRow}>
            <Pressable
              style={[styles.btnSecondary, styles.loginActionBtn, busy && styles.btnDisabled]}
              disabled={busy}
              onPress={() => void signInAnonymous()}
            >
              <Text style={[styles.btnSecondaryText, styles.loginAnonText]}>MODO ANONIMO</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.loginActionBtn, busy && styles.btnDisabled]}
              disabled={busy}
              onPress={() => void signIn()}
            >
              {busy ? <ActivityIndicator color={C.line} /> : <Text style={styles.btnText}>INGRESAR</Text>}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  if (screen === "table" && lastMatchId && activeCharacterId) {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <PlayerTableScreen
          supabase={supabase}
          matchId={lastMatchId}
          characterId={activeCharacterId}
          sessionEmail={sessionEmail ?? "Invitado (anónimo)"}
          busy={busy}
          pending={pending}
          pendingOpenChecks={pendingOpenChecks}
          pendingOpenChecksCount={pendingOpenChecksCount}
          rollValue={rollValue}
          tokensSpent={tokensSpent}
          onChangeRoll={setRollValue}
          onChangeTokens={setTokensSpent}
          onRefreshChecks={refreshPendingCheck}
          onSelectPendingCheck={(checkId) => {
            const picked = pendingOpenChecks.find((row) => row.check_id === checkId) ?? null;
            if (picked) {
              setPending(picked);
            }
          }}
          onSubmitResponse={(roll, tokens, modifier, userComment, steps) =>
            void submitResponse(roll, tokens, modifier, userComment, steps)
          }
          onLeaveTable={() => void leaveTable()}
          onSignOut={() => void signOut()}
          sheetTick={tableSheetTick}
          onUpgradesChanged={() => setTableSheetTick((n) => n + 1)}
        />
      </KeyboardAvoidingView>
    );
  }

  /* hub */
  return (
    <>
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.hubTopBar}>
          <Pressable style={[styles.hubSignOutBtn, busy && styles.btnDisabled]} disabled={busy} onPress={() => void signOut()}>
            <Text style={styles.hubSignOutText}>Salir</Text>
          </Pressable>
          <View style={styles.hubTopSpacer} />
        </View>
        <Text style={styles.hubTitle}>DXD — JUGADOR</Text>

        <Text style={styles.session}>Sesión: {sessionEmail ?? "Invitado (anónimo)"}</Text>
        {myUserId ? <Text style={styles.monoSmall}>Tu user id: {myUserId}</Text> : null}

        <Text style={styles.label}>Código o ID de partida</Text>
        {skipJoinRpc ? (
          <>
            <Text style={styles.muted}>Ya estás en la partida: elegí un personaje abajo y tocá «Ir a la mesa».</Text>
            <Pressable
              style={[styles.btnSecondary, { marginTop: 10, alignSelf: "flex-start" }]}
              disabled={busy}
              onPress={() => {
                void (async () => {
                  const mid = lastMatchId?.trim();
                  if (mid) {
                    try {
                      await rpcLeaveMatchPresence(supabase, { matchId: mid });
                    } catch {
                      /* sin RPC o red */
                    }
                  }
                  setSkipJoinRpc(false);
                  setJoinCode("");
                  setLastMatchId(null);
                })();
              }}
            >
              <Text style={styles.btnSecondaryText}>Cancelar y borrar código</Text>
            </Pressable>
          </>
        ) : null}
        <View style={styles.joinCodeRow}>
          <TextInput
            style={[styles.input, styles.joinCodeInput, skipJoinRpc && styles.inputDisabled]}
            autoCapitalize="none"
            value={joinCode}
            onChangeText={setJoinCode}
            placeholder="Ej. 55C1E8 o UUID…"
            editable={!skipJoinRpc}
            placeholderTextColor={PLACEHOLDER}
          />
          <Pressable
            style={[styles.btn, styles.joinSubmitBtn, busy && styles.btnDisabled]}
            disabled={busy}
            onPress={() => void doJoinMatch()}
          >
            {busy ? (
              <ActivityIndicator color={C.line} />
            ) : (
              <Text style={styles.btnText}>{skipJoinRpc ? "Ir a la mesa" : "Unirme"}</Text>
            )}
          </Pressable>
        </View>

        <Pressable
          style={[styles.btnSecondary, styles.hubInviteBtn, busy && styles.btnDisabled]}
          disabled={busy}
          onPress={() => {
            void loadInvites();
            setInvitesModalOpen(true);
          }}
          accessibilityLabel="Abrir invitaciones"
        >
          <Text style={styles.btnSecondaryText}>Invitaciones</Text>
        </Pressable>

        <Text style={styles.sectionTitle}>PERSONAJES</Text>
        <Text style={styles.muted}>{libraryChars.length} personaje(s).</Text>

        <View style={styles.libraryGridCols}>
          {Array.from({ length: 4 }).map((_, colIdx) => (
            <View key={`col-${colIdx}`} style={styles.libraryCol}>
              {Array.from({ length: 4 }).map((__, rowIdx) => {
                const cellIndex = colIdx + rowIdx * 4;
                const absIndex = safeLibraryPage * LIB_GRID_SIZE + cellIndex;
                const char = absIndex < libraryChars.length ? libraryChars[absIndex] : null;
                const isCreate = absIndex === libraryChars.length;

                if (char) {
                  return (
                    <Pressable
                      key={char.id}
                      style={[styles.libraryCard, joinSelectedCharId === char.id && styles.libraryCardOn]}
                      disabled={busy}
                      onPress={() => setJoinSelectedCharId(char.id)}
                      onLongPress={() => {
                        setEditingCharacterId(char.id);
                        setEditModalOpen(true);
                      }}
                      delayLongPress={450}
                      accessibilityLabel={`Personaje ${char.name}`}
                      accessibilityHint="Tocá para elegir con qué personaje unirte. Mantené apretado para editar"
                    >
                      <View style={styles.libraryAvatarWrap}>
                        {char.avatar_url ? (
                          <Image source={{ uri: char.avatar_url }} style={styles.libraryAvatar} resizeMode="cover" />
                        ) : (
                          <View style={styles.libraryAvatarFallback}>
                            <Text style={styles.libraryAvatarFallbackText}>Sin foto</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.libraryCardName} numberOfLines={2}>
                        {char.name}
                      </Text>
                    </Pressable>
                  );
                }

                if (isCreate) {
                  return (
                    <Pressable
                      key="__add__"
                      style={[styles.libraryCard, styles.libraryAddCard, busy && styles.btnDisabled]}
                      disabled={busy}
                      onPress={() => {
                        setPendingCreatePortraitUri(null);
                        setCreateStatTraining(initialStatTraining());
                        setCreateModalOpen(true);
                      }}
                      accessibilityLabel="Crear personaje"
                      accessibilityHint="Abrí el formulario para crear un personaje nuevo"
                    >
                      <View style={[styles.libraryAvatarWrap, styles.libraryAddAvatarWrap]}>
                        <Text style={styles.libraryAddPlus}>+</Text>
                      </View>
                      <Text style={styles.libraryCardName} numberOfLines={1}>
                        Crear
                      </Text>
                    </Pressable>
                  );
                }

                return <View key={`empty-${colIdx}-${rowIdx}`} style={styles.libraryEmptySlot} />;
              })}
            </View>
          ))}
        </View>

        {libraryPages > 1 ? (
          <View style={styles.libraryPager}>
            <Pressable
              style={[styles.pagerBtn, libraryPage === 0 && styles.pagerBtnDisabled]}
              disabled={libraryPage === 0 || busy}
              onPress={() => setLibraryPage((p) => Math.max(0, p - 1))}
            >
              <Text style={styles.pagerBtnText}>← Anterior</Text>
            </Pressable>
            <Text style={styles.pagerInfo}>
              Página {libraryPage + 1}/{libraryPages}
            </Text>
            <Pressable
              style={[styles.pagerBtn, libraryPage === libraryPages - 1 && styles.pagerBtnDisabled]}
              disabled={libraryPage === libraryPages - 1 || busy}
              onPress={() => setLibraryPage((p) => Math.min(libraryPages - 1, p + 1))}
            >
              <Text style={styles.pagerBtnText}>Siguiente →</Text>
            </Pressable>
          </View>
        ) : null}

      </ScrollView>
    </KeyboardAvoidingView>

    <Modal
      visible={editModalOpen && editingCharacterId != null}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={() => {
        setPendingEditPortraitUri(null);
        setEditingCharacterId(null);
        setEditModalOpen(false);
      }}
    >
      <KeyboardAvoidingView style={styles.invitesModalRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.invitesModalHead}>
          <Text style={styles.invitesModalTitle}>Editar personaje</Text>
          <Pressable
            onPress={() => {
              setPendingEditPortraitUri(null);
              setEditingCharacterId(null);
              setEditModalOpen(false);
            }}
            style={styles.invitesModalCloseBtn}
          >
            <Text style={styles.invitesModalCloseText}>Cerrar</Text>
          </Pressable>
        </View>
        <ScrollView style={styles.invitesModalScroll} contentContainerStyle={styles.invitesModalScrollInner} keyboardShouldPersistTaps="handled">
          <View style={styles.tabRow}>
            <Pressable
              style={[styles.tabBtn, editCharacterTab === "datos" && styles.tabBtnOn]}
              onPress={() => setEditCharacterTab("datos")}
            >
              <Text style={[styles.tabBtnText, editCharacterTab === "datos" && styles.tabBtnTextOn]}>Datos</Text>
            </Pressable>
            <Pressable
              style={[
                styles.tabBtn,
                editCharacterTab === "progresos" && styles.tabBtnOn,
                !chapterUpgradesOpen && styles.tabBtnDisabled,
              ]}
              onPress={() => {
                if (!chapterUpgradesOpen) return;
                setEditCharacterTab("progresos");
              }}
            >
              <Text style={[styles.tabBtnText, editCharacterTab === "progresos" && styles.tabBtnTextOn]}>Progresos</Text>
            </Pressable>
          </View>
          {editCharacterTab === "datos" ? (
            <>
              <Text style={styles.label}>Nombre</Text>
              <TextInput
                style={styles.input}
                value={editCharName}
                onChangeText={setEditCharName}
                placeholder="Nombre"
                placeholderTextColor={PLACEHOLDER}
              />
              <Text style={styles.label}>Vista previa del retrato (120×120)</Text>
              <View style={styles.avatarPreviewWrap}>
                <Pressable
                  style={styles.avatarPreview}
                  disabled={busy}
                  onPress={() => {
                    void (async () => {
                      const uri = await pickAndPreparePortraitJpeg();
                      if (uri) setPendingEditPortraitUri(uri);
                    })();
                  }}
                >
                  {(() => {
                    const uri = pendingEditPortraitUri ?? remoteImageUrl(editCharAvatar);
                    return uri ? (
                      <Image source={{ uri }} style={styles.avatarPreviewImage} resizeMode="cover" />
                    ) : (
                      <View style={styles.avatarPreviewEmpty}>
                        <Text style={styles.avatarPreviewEmptyText}>Click para importar</Text>
                      </View>
                    );
                  })()}
                </Pressable>
              </View>
              {pendingEditPortraitUri ? (
                <Pressable style={[styles.btnSecondary, { marginTop: 8 }]} onPress={() => setPendingEditPortraitUri(null)}>
                  <Text style={styles.btnSecondaryText}>Quitar imagen importada (sin guardar aún)</Text>
                </Pressable>
              ) : null}
              {editingCharacterId ? (
                <Pressable
                  style={[styles.hubSignOutBtn, { marginTop: 16, alignSelf: "stretch" }]}
                  disabled={busy}
                  onPress={() => {
                    const c = libraryChars.find((x) => x.id === editingCharacterId);
                    if (c) confirmArchiveCharacter(c);
                  }}
                >
                  <Text style={styles.hubSignOutText}>Eliminar personaje</Text>
                </Pressable>
              ) : null}
            </>
          ) : (
            <>
              <Text style={styles.subheading}>Mejoras de capítulo</Text>
              <Text style={styles.muted}>Solo se pueden comprar cuando el master termina el capítulo.</Text>
              <Text style={styles.muted}>Estado: {chapterUpgradesOpen ? "HABILITADO" : "BLOQUEADO"}.</Text>
              {STAT_KEYS.map((key) => (
                <View key={key} style={styles.trainingStatRow}>
                  <Text style={styles.statRowLabel}>{mapVisibleStatLabel(key, null)}</Text>
                  <Text style={styles.trainingTierText}>{trainingTierLongLabelEs(editStatTraining[key])}</Text>
                  {(() => {
                    const next = nextTrainingTier(editStatTraining[key]);
                    const cost = next ? tokenCostForNextTier(next) : null;
                    if (!next || !cost) return <Text style={styles.trainingTierText}>Máximo</Text>;
                    const disabled = !chapterUpgradesOpen || buyingTrainingKey !== null;
                    return (
                      <Pressable
                        style={[styles.tierBuyBtn, disabled && styles.tierBuyBtnOff]}
                        disabled={disabled}
                        onPress={() => void buyNextTraining(key)}
                      >
                        <Text style={styles.tierBuyBtnText}>
                          {buyingTrainingKey === key
                            ? "…"
                            : `Comprar ${next === "trained_in" ? "TI" : next === "studied_in" ? "SI" : "MI"} (${cost})`}
                        </Text>
                      </Pressable>
                    );
                  })()}
                </View>
              ))}
            </>
          )}
          <Pressable style={[styles.btn, busy && styles.btnDisabled]} disabled={busy} onPress={() => void saveEditCharacter()}>
            {busy ? <ActivityIndicator color={C.line} /> : <Text style={styles.btnText}>Guardar</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>

    <Modal
      visible={createModalOpen}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={() => {
        setPendingCreatePortraitUri(null);
        setCreateStatTraining(initialStatTraining());
        setCreateModalOpen(false);
      }}
    >
      <KeyboardAvoidingView style={styles.invitesModalRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.invitesModalHead}>
          <Text style={styles.invitesModalTitle}>Nuevo personaje</Text>
          <Pressable
            onPress={() => {
              setPendingCreatePortraitUri(null);
              setCreateStatTraining(initialStatTraining());
              setCreateModalOpen(false);
            }}
            style={styles.invitesModalCloseBtn}
          >
            <Text style={styles.invitesModalCloseText}>Cerrar</Text>
          </Pressable>
        </View>
        <ScrollView style={styles.invitesModalScroll} contentContainerStyle={styles.invitesModalScrollInner} keyboardShouldPersistTaps="handled">
          <Text style={[styles.label, { textAlign: "center" }]}>Nombre del personaje</Text>
          <TextInput
            style={styles.input}
            value={characterName}
            onChangeText={setCharacterName}
            placeholder="Nombre"
            placeholderTextColor={PLACEHOLDER}
          />
          <View style={styles.avatarPreviewWrap}>
            <Pressable
              style={styles.avatarPreview}
              disabled={busy}
              onPress={() => {
                void (async () => {
                  const uri = await pickAndPreparePortraitJpeg();
                  if (uri) setPendingCreatePortraitUri(uri);
                })();
              }}
            >
              {(() => {
                const uri = pendingCreatePortraitUri;
                return uri ? (
                  <Image source={{ uri }} style={styles.avatarPreviewImage} resizeMode="cover" />
                ) : (
                  <View style={styles.avatarPreviewEmpty}>
                    <Text style={styles.avatarPreviewEmptyText}>Click para importar</Text>
                  </View>
                );
              })()}
            </Pressable>
          </View>
          {pendingCreatePortraitUri ? (
            <Pressable style={[styles.btnSecondary, { marginTop: 8 }]} onPress={() => setPendingCreatePortraitUri(null)}>
              <Text style={styles.btnSecondaryText}>Quitar imagen importada</Text>
            </Pressable>
          ) : null}

          <View style={styles.createStatsBlock}>
            <View style={styles.statGrid}>
              {STAT_KEYS.map((key) => (
                <View key={key} style={[styles.statRow, styles.statGridItem]}>
                  <Text style={[styles.statRowLabel, styles.statGridItemLabel]}>{mapVisibleStatLabel(key, null)}</Text>
                  <View style={styles.dieRow}>
                    <Pressable style={styles.dieNavBtn} onPress={() => bumpStatDie(key, -1)} hitSlop={8}>
                      <Text style={styles.dieNavText}>‹</Text>
                    </Pressable>
                    <Text style={styles.dieBig}>d{statDice[key]}</Text>
                    <Pressable style={styles.dieNavBtn} onPress={() => bumpStatDie(key, 1)} hitSlop={8}>
                      <Text style={styles.dieNavText}>›</Text>
                    </Pressable>
                  </View>
                  <View style={styles.inlineTierRow}>
                    {CREATE_TRAINING_TIERS.map((tier) => {
                      const selected = createStatTraining[key] === tier;
                      return (
                        <Pressable
                          key={`${key}-inline-${tier}`}
                          style={[styles.inlineTierBtn, selected && styles.inlineTierBtnOn]}
                          onPress={() =>
                            setCreateStatTraining((prev) => ({
                              ...prev,
                              [key]: selected ? "none" : tier,
                            }))
                          }
                        >
                          <Text style={[styles.inlineTierText, selected && styles.inlineTierTextOn]}>
                            {CREATE_TRAINING_TIER_SHORT_LABEL[tier]}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
          </View>

          <Pressable style={[styles.btn, busy && styles.btnDisabled]} disabled={busy} onPress={() => void createMinimalCharacter()}>
            {busy ? <ActivityIndicator color={C.line} /> : <Text style={styles.btnText}>Guardar en biblioteca</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>

    <Modal
      visible={invitesModalOpen}
      animationType="fade"
      transparent={false}
      presentationStyle="fullScreen"
      onRequestClose={() => setInvitesModalOpen(false)}
    >
      <View style={styles.invitesPopupBackdrop}>
        <View style={styles.invitesPopupCard}>
          <View style={styles.invitesPopupHead}>
            <Text style={styles.invitesModalTitle}>Invitaciones</Text>
            <Pressable onPress={() => setInvitesModalOpen(false)} style={styles.invitesPopupCloseBtn}>
              <Text style={styles.invitesPopupCloseText}>Cerrar</Text>
            </Pressable>
          </View>
          <ScrollView
            style={styles.invitesPopupScroll}
            contentContainerStyle={styles.invitesModalScrollInner}
            keyboardShouldPersistTaps="handled"
          >
            {invites.length === 0 ? (
              <Text style={styles.muted}>
                No tenés invitaciones pendientes (o falta migrar `match_invites` en Supabase).
              </Text>
            ) : (
              invites.map((inv) => {
                const m = matchFromInvite(inv);
                return (
                  <View key={inv.id} style={styles.inviteCard}>
                    <Text style={styles.cardTitle}>{m?.title ?? "Partida"}</Text>
                    <Text style={styles.muted}>Código: {m?.code ?? "—"}</Text>
                    <View style={styles.inviteRow}>
                      <Pressable
                        style={[styles.btn, styles.inviteActionBtn]}
                        disabled={busy}
                        onPress={() => void respondInvite(inv, true)}
                      >
                        <Text style={styles.btnText}>Unirme</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.btnSecondary, styles.inviteActionBtn]}
                        disabled={busy}
                        onPress={() => void respondInvite(inv, false)}
                      >
                        <Text style={styles.btnSecondaryText}>Rechazar</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
          <Pressable onPress={() => setInvitesModalOpen(false)} style={styles.invitesPopupFooterClose}>
            <Text style={styles.invitesPopupCloseText}>Cerrar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 20, paddingTop: 48, paddingBottom: 40 },
  /** Solo pantalla de login: más aire arriba. */
  loginScreenScroll: { padding: 20, paddingTop: 92, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: C.bg },
  h1: { fontSize: 22, fontWeight: "700", color: C.line, marginBottom: 8 },
  screenTitleCentered: { fontSize: 22, fontWeight: "700", color: C.line, textAlign: "center", marginBottom: 10 },
  loginTitle: { fontSize: 22, fontWeight: "800", color: C.line, textAlign: "center", alignSelf: "center", marginBottom: 14 },
  loginBoxTitle: { fontSize: 18, fontWeight: "800", color: C.line, textAlign: "center", marginBottom: 10 },
  hubTitle: { fontSize: 30, fontWeight: "800", color: C.line, textAlign: "center", marginBottom: 10 },
  hubTopBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  hubTopSpacer: { width: 62 },
  hubSignOutBtn: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "rgba(127,29,29,0.35)",
    borderWidth: 1,
    borderColor: "#dc2626",
  },
  hubSignOutText: { color: "#fecaca", fontSize: 13, fontWeight: "700" },
  hubActionsRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
    marginTop: 18,
  },
  hubActionBtn: {
    flex: 1,
    minWidth: 0,
    marginTop: 0,
  },
  hubInviteBtn: {
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
  },
  /** Popup de invitaciones (misma idea que mesa: backdrop + tarjeta centrada). */
  invitesPopupBackdrop: {
    flex: 1,
    backgroundColor: C.bg,
    justifyContent: "center",
    alignItems: "center",
    padding: 14,
  },
  invitesPopupCard: {
    width: "100%",
    /** ~30% más chico que el tamaño base (620×85%). */
    maxWidth: 434,
    flex: 1,
    maxHeight: "59.5%",
    minHeight: 0,
    borderWidth: 2,
    borderColor: C.line,
    backgroundColor: C.panel,
    padding: 12,
  },
  invitesPopupHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  invitesPopupCloseBtn: {
    borderWidth: 1,
    borderColor: C.line,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  invitesPopupCloseText: { color: C.text, fontSize: 12, fontWeight: "700" },
  invitesPopupScroll: { flex: 1, marginTop: 10, minHeight: 0 },
  invitesPopupFooterClose: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: C.lineDim,
    paddingVertical: 10,
    alignItems: "center",
  },
  invitesModalRoot: {
    flex: 1,
    backgroundColor: C.bg,
    paddingHorizontal: 20,
    paddingTop: 52,
    paddingBottom: 24,
  },
  invitesModalHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  invitesModalTitle: { fontSize: 20, fontWeight: "800", color: C.line },
  invitesModalCloseBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.lineDim,
    backgroundColor: C.panel,
  },
  invitesModalCloseText: { color: C.text, fontWeight: "700", fontSize: 13 },
  invitesModalScroll: { flex: 1, marginTop: 12 },
  invitesModalScrollInner: { paddingBottom: 32 },
  joinCodeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 6,
  },
  joinCodeInput: {
    flex: 1,
    minWidth: 0,
    marginTop: 0,
  },
  joinSubmitBtn: {
    marginTop: 0,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexShrink: 0,
    minWidth: 112,
    alignItems: "center",
    justifyContent: "center",
  },
  joinTopBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  joinMenuBtn: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, backgroundColor: C.panel, borderWidth: 1, borderColor: C.lineDim },
  joinTitle: { flex: 1, textAlign: "center", fontSize: 24, fontWeight: "800", color: C.line, marginHorizontal: 8 },
  joinTopSpacer: { width: 74 },
  lead: { fontSize: 15, color: C.textMuted, marginBottom: 20 },
  sectionTitle: { marginTop: 22, fontSize: 17, fontWeight: "700", color: C.text },
  subheading: { marginTop: 14, marginBottom: 6, fontSize: 14, fontWeight: "600", color: C.textMuted },
  bold: { fontWeight: "700", color: C.text },
  label: { fontSize: 13, fontWeight: "600", color: C.textMuted, marginTop: 12 },
  createStatsBlock: {
    marginTop: 18,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.lineFaint,
  },
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 8,
  },
  statRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 8,
    backgroundColor: C.panel,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.lineDim,
  },
  statGridItem: {
    width: "48%",
    marginTop: 0,
    paddingVertical: 10,
    paddingHorizontal: 10,
    flexDirection: "column",
    justifyContent: "center",
  },
  statGridItemLabel: {
    flex: 0,
    marginBottom: 8,
    textAlign: "center",
    fontSize: 14,
  },
  statRowLabel: { fontSize: 15, fontWeight: "600", color: C.text, flex: 1 },
  dieRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dieNavBtn: {
    minWidth: 36,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: C.panel2,
    borderWidth: 1,
    borderColor: C.lineFaint,
    alignItems: "center",
  },
  dieNavText: { fontSize: 20, fontWeight: "700", color: C.line, lineHeight: 24 },
  dieBig: { fontSize: 16, fontWeight: "700", color: C.warn, minWidth: 48, textAlign: "center" },
  inlineTierRow: {
    marginTop: 8,
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  inlineTierBtn: {
    minWidth: 36,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.lineDim,
    backgroundColor: C.bg,
    alignItems: "center",
  },
  inlineTierBtnOn: {
    borderColor: C.line,
    backgroundColor: C.panel2,
  },
  inlineTierText: { fontSize: 13, fontWeight: "700", color: C.textMuted },
  inlineTierTextOn: { color: C.text },
  input: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: C.lineDim,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: C.bg,
    color: C.text,
  },
  inputDisabled: { opacity: 0.65, backgroundColor: C.panel },
  btn: {
    marginTop: 20,
    backgroundColor: C.panel2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.line,
    paddingVertical: 14,
    alignItems: "center",
  },
  /** Segundo botón principal (ej. Unirme a partida): mismo peso visual, borde verde. */
  btnAlt: {
    backgroundColor: C.panel,
    borderColor: C.lineDim,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: C.text, fontSize: 16, fontWeight: "600" },
  loginActionsRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
    marginTop: 22,
    alignSelf: "stretch",
  },
  loginActionBtn: {
    flex: 1,
    minWidth: 0,
    marginTop: 0,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  loginAnonText: { textAlign: "center" },
  loginNameDomainRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  loginLocalInput: { marginTop: 0, flex: 1 },
  domainDropdownBtn: {
    marginTop: 0,
    height: 44,
    borderWidth: 1,
    borderColor: C.lineDim,
    borderRadius: 8,
    backgroundColor: C.bg,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  domainDropdownText: { color: C.textMuted, fontWeight: "700" },
  dropdownOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 20,
  },
  dropdownSheet: {
    borderRadius: 10,
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.lineDim,
    paddingVertical: 8,
    overflow: "hidden",
  },
  dropdownItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  dropdownItemOn: {
    backgroundColor: "rgba(102,255,102,0.12)",
  },
  dropdownItemText: {
    color: C.textMuted,
    fontWeight: "700",
  },
  dropdownItemTextOn: { color: C.text },
  btnSecondary: {
    marginTop: 10,
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.lineDim,
  },
  btnSecondaryText: { color: C.text, fontWeight: "600" },
  session: { marginTop: 8, fontSize: 14, color: C.text },
  monoSmall: { marginTop: 4, fontSize: 11, color: C.textMuted },
  ok: { marginTop: 10, fontSize: 15, fontWeight: "600", color: C.line },
  errorTitle: { fontSize: 18, fontWeight: "700", marginBottom: 8, color: "#fecaca" },
  muted: { fontSize: 14, color: C.textMuted, lineHeight: 20, marginTop: 4 },
  card: {
    marginTop: 14,
    padding: 14,
    borderRadius: 10,
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.lineSoft,
  },
  cardTitle: { fontSize: 16, fontWeight: "700", color: C.text },
  charPick: {
    marginTop: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.lineDim,
    backgroundColor: C.panel,
  },
  charPickOn: { borderColor: C.line, backgroundColor: "rgba(102, 255, 102, 0.1)" },
  charPickText: { fontSize: 16, fontWeight: "600", color: C.text },
  inviteCard: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.lineSoft,
  },
  inviteRow: { flexDirection: "row", alignItems: "stretch", gap: 12, marginTop: 10 },
  inviteActionBtn: {
    flex: 1,
    marginTop: 0,
    alignSelf: "stretch",
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
  },
  linkish: { marginTop: 8, alignSelf: "center" },
  linkishText: { fontSize: 14, color: C.line, fontWeight: "600" },
  domainScroll: { marginTop: 8, maxHeight: 44 },
  domainChip: {
    marginRight: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.lineDim,
  },
  domainChipOn: { backgroundColor: C.panel2, borderColor: C.line },
  domainChipText: { fontSize: 13, fontWeight: "600", color: C.textMuted },
  domainChipTextOn: { color: C.text },
  recentChip: {
    marginRight: 8,
    maxWidth: 220,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.lineDim,
  },
  recentChipText: { fontSize: 12, color: C.text },
  editListBtn: {
    marginTop: 12,
    alignSelf: "flex-start",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.lineDim,
    backgroundColor: C.panel,
  },
  editListBtnActive: {
    backgroundColor: C.panel2,
    borderColor: C.line,
  },
  editListBtnText: { fontSize: 15, fontWeight: "700", color: C.textMuted },
  editListBtnTextActive: { color: C.text },
  /** Grilla 4×4 (16 celdas por página). */
  libraryGridCols: {
    marginTop: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 6,
  },
  libraryCol: {
    flex: 1,
    minWidth: 0,
    gap: 8,
    alignItems: "stretch",
  },
  libraryEmptySlot: {
    minHeight: 138,
    backgroundColor: "transparent",
    borderWidth: 0,
  },
  /** Tarjetas ampliadas (~50% vs. diseño original 92px). */
  libraryCard: {
    width: "100%",
    minHeight: 138,
    backgroundColor: C.panel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.lineDim,
    padding: 9,
    alignItems: "center",
    justifyContent: "flex-start",
  },
  libraryCardOn: {
    borderColor: C.line,
    backgroundColor: "rgba(102, 255, 102, 0.12)",
  },
  libraryAvatarWrap: {
    width: "100%",
    height: 84,
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.lineDim,
    backgroundColor: C.bg,
  },
  libraryAvatar: { width: "100%", height: "100%" },
  libraryAvatarFallback: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  libraryAvatarFallbackText: { fontSize: 14, color: C.textMuted, textAlign: "center" },
  libraryAddCard: { justifyContent: "flex-start" },
  libraryAddAvatarWrap: { alignItems: "center", justifyContent: "center", backgroundColor: C.panel2, borderColor: C.line },
  libraryAddPlus: { fontSize: 51, fontWeight: "400", color: C.line, lineHeight: 54 },
  libraryCardName: { marginTop: 6, fontSize: 16, fontWeight: "700", color: C.text, textAlign: "center", width: "100%" },
  libraryPager: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  pagerBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: C.panel2,
    borderWidth: 1,
    borderColor: C.lineFaint,
  },
  pagerBtnDisabled: { opacity: 0.5 },
  pagerBtnText: { color: C.text, fontWeight: "700", fontSize: 13 },
  pagerInfo: { color: C.textMuted, fontWeight: "700", fontSize: 13 },
  libraryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginTop: 6,
    backgroundColor: C.panel,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.lineDim,
  },
  libraryRowName: { fontSize: 16, fontWeight: "600", color: C.text, flex: 1, marginRight: 10 },
  minusBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(69, 10, 10, 0.85)",
    borderWidth: 2,
    borderColor: "#dc2626",
    alignItems: "center",
    justifyContent: "center",
  },
  minusBtnGlyph: {
    fontSize: 28,
    fontWeight: "300",
    color: "#fecaca",
    lineHeight: 32,
    marginTop: -2,
  },
  avatarPreviewWrap: { marginTop: 8, alignItems: "center" },
  avatarPreview: {
    width: 120,
    height: 120,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.lineDim,
  },
  avatarPreviewImage: { width: "100%", height: "100%" },
  avatarPreviewEmpty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 8 },
  avatarPreviewEmptyText: { fontSize: 13, color: C.textMuted, textAlign: "center" },
  tabRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.lineDim,
    alignItems: "center",
  },
  tabBtnOn: {
    backgroundColor: C.panel2,
    borderColor: C.line,
  },
  tabBtnDisabled: { opacity: 0.45 },
  tabBtnText: { fontSize: 14, fontWeight: "600", color: C.textMuted },
  tabBtnTextOn: { color: C.text },
  trainingStatRow: {
    alignItems: "flex-start",
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 8,
    backgroundColor: C.panel,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.lineDim,
    gap: 10,
  },
  trainingTierText: { fontSize: 12, fontWeight: "600", color: C.textMuted },
  tierBuyBtn: {
    marginTop: 6,
    alignSelf: "flex-start",
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: 8,
    backgroundColor: C.panel2,
    borderWidth: 1,
    borderColor: C.line,
  },
  tierBuyBtnOff: { opacity: 0.5 },
  tierBuyBtnText: { fontSize: 12, fontWeight: "700", color: C.text },
});
