import {
  STAT_KEYS,
  computeExplosionChainDiceTotal,
  computeRequiredExplosionRowCount,
  cumulativeThroughExoRow,
  effectiveStatModifier,
  explosionChainStatusLine,
  isStatTrainingTier,
  mapVisibleStatLabel,
  nextTrainingTier,
  rpcPurchaseNextStatTraining,
  tokenCostForNextTier,
  trainingTierLongLabelEs,
  trainingTierShortLabel,
  validateDesktopExplosionChain,
} from "@dxd/shared";
import type { ExplosionSegment, StatKey } from "@dxd/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { type ComponentProps, useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

/** Reglas estéticas: fondo oscuro/negro, contornos y tablas en verde #66ff66. */
const LINE = "#66ff66";

function parseIntSafe(s: string): number {
  const n = Number.parseInt(String(s ?? "").trim(), 10);
  return Number.isNaN(n) ? 0 : n;
}

type MciName = NonNullable<ComponentProps<typeof MaterialCommunityIcons>["name"]>;

/** MaterialCommunityIcons; mismos glifos que master-web (`@mdi/js`). Flight: reptil (no hay camaleón en el set). */
const STAT_ICON_NAMES: Record<StatKey, MciName> = {
  brains: "brain",
  brawn: "arm-flex",
  charm: "emoticon-kiss",
  fight: "sword-cross",
  flight: "snake",
  grit: "shield-outline",
};

function formatStatModifierLine(mod: number): string {
  if (mod === 0) return "—";
  return mod > 0 ? `+${mod}` : String(mod);
}

const mesaPalette = {
  bg: "#000000",
  panel: "#0a0a0a",
  border: LINE,
  borderDim: "rgba(102, 255, 102, 0.4)",
  text: "#b3ffb3",
  textBright: "#d9ffd9",
  textMuted: "rgba(102, 255, 102, 0.62)",
  accent: LINE,
  warn: "#facc15",
};

export type TablePendingCheck = {
  check_id: string;
  character_id: string;
  checks: {
    check_value: number;
    stat_label_at_time: string;
    status: string;
    stat_key: string;
  } | null;
};

type StatRow = {
  stat_key: string;
  stat_label: string;
  die_size: string;
  base_modifier: number;
  /** Migración `stat_training_tokens`; si falta en fila, tratamos como none. */
  training_tier?: string | null;
};

type RuntimeRow = {
  current_tokens: number;
  current_modifier: number;
  last_roll_value: number | null;
  last_total_value: number | null;
  last_result: string | null;
  last_margin: number | null;
  check_status: string;
};

type SheetLoad = {
  name: string;
  avatar_url: string | null;
  concept: string | null;
  stats: StatRow[];
  starting_tokens: number;
  runtime: RuntimeRow | null;
};

type Props = {
  supabase: SupabaseClient;
  matchId: string;
  characterId: string;
  sessionEmail: string | null;
  busy: boolean;
  pending: TablePendingCheck | null;
  /** Lista de checks abiertos para elegir cuál responder. */
  pendingOpenChecks: TablePendingCheck[];
  /** Cantidad de checks abiertos sin responder (cola). */
  pendingOpenChecksCount: number;
  rollValue: string;
  tokensSpent: string;
  onChangeRoll: (v: string) => void;
  onChangeTokens: (v: string) => void;
  /** Refrescar checks pendientes / estado (p. ej. pull-to-refresh). Puede ser async. */
  onRefreshChecks: () => void | Promise<void>;
  /** Elegir check activo (cuando hay más de uno pendiente). */
  onSelectPendingCheck: (checkId: string) => void;
  /**
   * Tirada principal, fichas, MOD del stat y segmentos extra si la cadena explotó
   * (regla desktop: dado+fichas=cara máxima → más filas).
   */
  onSubmitResponse: (
    roll: number,
    tokensSpent: number,
    statModifier: number,
    userComment?: string,
    explosionSteps?: ExplosionSegment[],
  ) => void;
  onLeaveTable: () => void;
  onSignOut: () => void;
  /** Incrementar desde el padre tras enviar check para refrescar runtime en mesa. */
  sheetTick: number;
  /** Tras comprar mejora de capítulo (refrescar fichas / stats). */
  onUpgradesChanged?: () => void;
};

export function PlayerTableScreen({
  supabase,
  matchId,
  characterId,
  sessionEmail,
  busy,
  pending,
  pendingOpenChecks,
  pendingOpenChecksCount,
  rollValue,
  tokensSpent,
  onChangeRoll,
  onChangeTokens,
  onRefreshChecks,
  onSelectPendingCheck,
  onSubmitResponse,
  onLeaveTable,
  onSignOut,
  sheetTick,
  onUpgradesChanged,
}: Props) {
  const checkModalKeyboardReserve = Platform.OS === "ios" ? 340 : 290;
  const [sheet, setSheet] = useState<SheetLoad | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [imgBroken, setImgBroken] = useState(false);
  const [chapterUpgradesOpen, setChapterUpgradesOpen] = useState(false);
  const [upgradesModalOpen, setUpgradesModalOpen] = useState(false);
  const [checksPickerModalOpen, setChecksPickerModalOpen] = useState(false);
  const [checksModalOpen, setChecksModalOpen] = useState(false);
  const [upgradeBusyKey, setUpgradeBusyKey] = useState<string | null>(null);
  /** Comentario del jugador para guardar junto a la respuesta del check. */
  const [checkComment, setCheckComment] = useState("");
  /** Filas post-tirada principal (dado+fichas por explosión). */
  const [explosionRows, setExplosionRows] = useState<{ roll: string; tokens: string }[]>([]);
  const [checksRefreshing, setChecksRefreshing] = useState(false);

  const onPullRefreshChecks = useCallback(async () => {
    if (busy) return;
    setChecksRefreshing(true);
    try {
      await Promise.resolve(onRefreshChecks());
    } finally {
      setChecksRefreshing(false);
    }
  }, [busy, onRefreshChecks]);

  const reloadSheet = useCallback(async () => {
    setLoadErr(null);
    try {
      const { data: ch, error: e1 } = await supabase
        .from("characters")
        .select("name, avatar_url, concept")
        .eq("id", characterId)
        .single();
      if (e1) throw e1;
      const { data: st, error: e2 } = await supabase
        .from("character_stats")
        .select("stat_key, stat_label, die_size, base_modifier, training_tier")
        .eq("character_id", characterId);
      if (e2) throw e2;
      const { data: res, error: e3 } = await supabase
        .from("character_resources")
        .select("starting_tokens")
        .eq("character_id", characterId)
        .maybeSingle();
      if (e3) throw e3;
      const { data: rt, error: e4 } = await supabase
        .from("character_runtime")
        .select(
          "current_tokens, current_modifier, last_roll_value, last_total_value, last_result, last_margin, check_status",
        )
        .eq("match_id", matchId)
        .eq("character_id", characterId)
        .maybeSingle();
      if (e4) throw e4;

      const { data: mRow, error: e5 } = await supabase
        .from("matches")
        .select("chapter_upgrades_open")
        .eq("id", matchId)
        .maybeSingle();
      if (e5) throw e5;
      setChapterUpgradesOpen(Boolean(mRow?.chapter_upgrades_open));

      const statsRaw = (st ?? []) as StatRow[];
      const order = new Map(STAT_KEYS.map((k, i) => [k, i]));
      statsRaw.sort((a, b) => (order.get(a.stat_key as StatKey) ?? 99) - (order.get(b.stat_key as StatKey) ?? 99));

      setSheet({
        name: String(ch?.name ?? "—"),
        avatar_url: (ch?.avatar_url as string | null)?.trim() || null,
        concept: (ch?.concept as string | null) ?? null,
        stats: statsRaw,
        starting_tokens: Number(res?.starting_tokens ?? 0),
        runtime: rt as RuntimeRow | null,
      });
      setImgBroken(false);
    } catch (e: unknown) {
      setLoadErr(e instanceof Error ? e.message : String(e));
      setSheet(null);
      setChapterUpgradesOpen(false);
    }
  }, [characterId, matchId, supabase]);

  const buyChapterUpgrade = useCallback(
    async (statKey: string) => {
      if (!sheet?.runtime) {
        Alert.alert("Mesa", "No hay runtime de mesa para este personaje.");
        return;
      }
      if (!chapterUpgradesOpen) {
        Alert.alert("Mejoras", "El director no habilitó las mejoras de capítulo. Pedile que active el interruptor en la mesa.");
        return;
      }
      setUpgradeBusyKey(statKey);
      try {
        const res = await rpcPurchaseNextStatTraining(supabase, {
          matchId,
          characterId,
          statKey,
        });
        await reloadSheet();
        onUpgradesChanged?.();
        const label = mapVisibleStatLabel(statKey as StatKey, sheet.stats.find((s) => s.stat_key === statKey)?.stat_label);
        Alert.alert(
          "Mejora comprada",
          `${label} → ${trainingTierLongLabelEs(res.training_tier)} (−${res.tokens_spent} fichas, ${res.current_tokens} restantes).`,
        );
      } catch (e: unknown) {
        Alert.alert("No se pudo comprar", e instanceof Error ? e.message : String(e));
      } finally {
        setUpgradeBusyKey(null);
      }
    },
    [chapterUpgradesOpen, characterId, matchId, onUpgradesChanged, reloadSheet, sheet, supabase],
  );

  useEffect(() => {
    void reloadSheet();
  }, [reloadSheet, sheetTick]);

  useEffect(() => {
    if (!chapterUpgradesOpen) {
      setUpgradesModalOpen(false);
    }
  }, [chapterUpgradesOpen]);

  useEffect(() => {
    setCheckComment("");
    setExplosionRows([]);
  }, [pending?.check_id]);

  const activeStat = pending?.checks?.stat_key;
  const activeStatRow = useMemo(() => {
    if (!activeStat || !sheet) return null;
    return sheet.stats.find((statRow) => statRow.stat_key === activeStat) ?? null;
  }, [activeStat, sheet]);
  const dieForCheck = useMemo(() => {
    return activeStatRow?.die_size ?? null;
  }, [activeStatRow]);
  const modForCheck = useMemo(() => {
    if (!activeStatRow) return null;
    return effectiveStatModifier(activeStatRow.base_modifier, activeStatRow.training_tier);
  }, [activeStatRow]);

  const displayTokens = sheet?.runtime?.current_tokens ?? sheet?.starting_tokens ?? 0;

  const statByKey = useMemo(() => {
    const m = new Map<string, StatRow>();
    for (const r of sheet?.stats ?? []) {
      m.set(r.stat_key, r);
    }
    return m;
  }, [sheet?.stats]);

  const maxDieFace = useMemo(() => {
    if (!dieForCheck) return null;
    const n = Number.parseInt(String(dieForCheck), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [dieForCheck]);

  useEffect(() => {
    if (!pending?.checks || maxDieFace == null) {
      setExplosionRows([]);
      return;
    }
    const dm = parseIntSafe(rollValue);
    const fm = parseIntSafe(tokensSpent || "0");
    setExplosionRows((prev) => {
      const exo = prev.map((r) => ({
        roll: parseIntSafe(r.roll),
        tokens: parseIntSafe(r.tokens || "0"),
      }));
      const target = computeRequiredExplosionRowCount(maxDieFace, dm, fm, exo);
      const next = prev.slice(0, target);
      while (next.length < target) next.push({ roll: "", tokens: "" });
      if (
        next.length === prev.length &&
        next.every((c, i) => c.roll === prev[i]?.roll && c.tokens === prev[i]?.tokens)
      ) {
        return prev;
      }
      return next;
    });
  }, [pending?.checks, maxDieFace, rollValue, tokensSpent]);

  const parsedMainSeg = useMemo(
    () => ({ roll: parseIntSafe(rollValue), tokens: parseIntSafe(tokensSpent || "0") }),
    [rollValue, tokensSpent],
  );
  const parsedExtrasSeg = useMemo(
    () => explosionRows.map((r) => ({ roll: parseIntSafe(r.roll), tokens: parseIntSafe(r.tokens || "0") })),
    [explosionRows],
  );

  /**
   * PASA/FALLA: total = MOD + ∑(dado+fichas) por segmento (principal + explosiones), vs CHECK.
   * Con tirada válida y cadena válida se usa `explosionChainStatusLine` (alineado al RPC/desktop).
   * Si la cadena está incompleta, no mostramos un resultado viejo del servidor.
   */
  const outcomeBannerLine = useMemo(() => {
    const serverBanner = (): string => {
      const lr = sheet?.runtime?.last_result;
      const lm = sheet?.runtime?.last_margin;
      if (lr === "pass" && lm != null) return `PASA +${lm}`;
      if (lr === "fail") return lm != null ? `FALLA ${lm}` : "FALLA";
      if (lr === "none" || !lr) return "—";
      return String(lr).toUpperCase();
    };

    if (!pending?.checks || modForCheck == null || maxDieFace == null) {
      return serverBanner();
    }
    if (parsedMainSeg.roll < 1 || parsedMainSeg.roll > maxDieFace) {
      return serverBanner();
    }
    const mainSeg: ExplosionSegment = { roll: parsedMainSeg.roll, tokens: parsedMainSeg.tokens };
    const chainErr = validateDesktopExplosionChain(maxDieFace, mainSeg, parsedExtrasSeg);
    if (chainErr) {
      return "—";
    }
    const { line } = explosionChainStatusLine(
      modForCheck,
      mainSeg,
      parsedExtrasSeg,
      pending.checks.check_value,
      maxDieFace,
    );
    return line;
  }, [
    maxDieFace,
    modForCheck,
    parsedExtrasSeg,
    parsedMainSeg,
    pending?.checks,
    sheet?.runtime?.last_margin,
    sheet?.runtime?.last_result,
  ]);

  const mainRowModTotalLabel = useMemo(() => {
    if (modForCheck == null || maxDieFace == null) return "—";
    if (parsedMainSeg.roll < 1) return "—";
    return String(modForCheck + computeExplosionChainDiceTotal(parsedMainSeg, parsedExtrasSeg));
  }, [maxDieFace, modForCheck, parsedExtrasSeg, parsedMainSeg]);

  const submitCheck = useCallback(() => {
    if (!pending?.checks || modForCheck == null || maxDieFace == null) {
      Alert.alert("Check", "No hay datos del check o del personaje.");
      return;
    }
    const rv = Number.parseInt(rollValue.trim(), 10);
    const ts = Number.parseInt((tokensSpent.trim() || "0"), 10);
    if (Number.isNaN(rv) || Number.isNaN(ts)) {
      Alert.alert("Check", "Escribí números enteros en dado y fichas.");
      return;
    }
    if (rv < 1 || rv > maxDieFace) {
      Alert.alert("Dado tirado", `Tiene que ser entre 1 y ${maxDieFace} (tu dado es d${maxDieFace}).`);
      return;
    }
    if (ts < 0) {
      Alert.alert("Fichas", "No podés gastar fichas negativas.");
      return;
    }
    const main: ExplosionSegment = { roll: rv, tokens: ts };
    const extras: ExplosionSegment[] = explosionRows.map((r) => ({
      roll: parseIntSafe(r.roll),
      tokens: parseIntSafe(r.tokens || "0"),
    }));
    const target = computeRequiredExplosionRowCount(maxDieFace, main.roll, main.tokens, extras);
    if (extras.length !== target) {
      Alert.alert("Check", "Completá todas las tiradas de la cadena de explosión.");
      return;
    }
    const chainErr = validateDesktopExplosionChain(maxDieFace, main, extras);
    if (chainErr) {
      Alert.alert("Check", chainErr);
      return;
    }
    for (const ex of extras) {
      if (ex.roll < 1 || ex.roll > maxDieFace) {
        Alert.alert("Check", `Cada dado debe estar entre 1 y ${maxDieFace}.`);
        return;
      }
    }
    const tokensTotal = ts + extras.reduce((a, x) => a + x.tokens, 0);
    if (tokensTotal > displayTokens) {
      Alert.alert("Fichas", `No tenés tantas fichas en mesa (gastás ${tokensTotal}, tenés ${displayTokens}).`);
      return;
    }
    onSubmitResponse(rv, ts, modForCheck, checkComment.trim(), extras.length > 0 ? extras : undefined);
  }, [
    checkComment,
    displayTokens,
    explosionRows,
    maxDieFace,
    modForCheck,
    onSubmitResponse,
    pending?.checks,
    rollValue,
    tokensSpent,
  ]);

  const openChecksFlow = useCallback(() => {
    if (busy) return;
    if (pendingOpenChecks.length > 1) {
      setChecksPickerModalOpen(true);
      return;
    }
    setChecksModalOpen(true);
  }, [busy, pendingOpenChecks.length]);

  return (
    <View style={tableStyles.root}>
      <ScrollView
        contentContainerStyle={tableStyles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={checksRefreshing}
            onRefresh={() => void onPullRefreshChecks()}
            tintColor={mesaPalette.accent}
            colors={[mesaPalette.accent]}
          />
        }
      >
        <View style={tableStyles.topBar}>
          <Pressable style={tableStyles.topBarBtn} onPress={() => void onLeaveTable()} disabled={busy}>
            <Text style={tableStyles.topBarBtnText}>← Menú</Text>
          </Pressable>
          <Text style={tableStyles.topBarTitle}>MESA</Text>
          <View style={tableStyles.topBarSpacer} />
        </View>

        {loadErr ? (
          <Text style={tableStyles.errText}>{loadErr}</Text>
        ) : !sheet ? (
          <ActivityIndicator color={mesaPalette.textBright} style={{ marginTop: 24 }} />
        ) : (
          <>
            <View style={tableStyles.heroFrame}>
              <View style={tableStyles.heroTopRow}>
                <View style={tableStyles.heroSideSpacer} />
                <View style={tableStyles.heroIdentityBlock}>
                  <View style={tableStyles.portraitRing}>
                    {sheet.avatar_url && !imgBroken ? (
                      <Image
                        key={sheet.avatar_url}
                        source={{ uri: sheet.avatar_url }}
                        style={tableStyles.portraitImg}
                        resizeMode="cover"
                        onError={() => setImgBroken(true)}
                        accessibilityLabel={`Retrato de ${sheet.name}`}
                      />
                    ) : (
                      <View style={tableStyles.portraitFallback}>
                        <Text style={tableStyles.portraitFallbackGlyph}>◆</Text>
                      </View>
                    )}
                  </View>
                  <View style={tableStyles.namePlate}>
                    <Text style={tableStyles.nameText} numberOfLines={1}>
                      {sheet.name}
                    </Text>
                  </View>
                </View>
                <View style={tableStyles.heroTokensBlock}>
                  <Text style={tableStyles.heroTokensLabel}>FICHAS</Text>
                  <Text style={tableStyles.heroTokensBig}>{displayTokens}</Text>
                </View>
              </View>
            </View>

            <View style={tableStyles.mesaActionRow}>
              <View style={tableStyles.mesaActionBtnWrap}>
                <Pressable
                  style={[tableStyles.mesaActionBtn, pending?.checks ? tableStyles.mesaActionBtnEmphasis : null]}
                  onPress={openChecksFlow}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={
                    pendingOpenChecksCount > 0
                      ? `Abrir checks, ${pendingOpenChecksCount} sin responder`
                      : "Abrir checks"
                  }
                >
                  <Text style={tableStyles.mesaActionBtnText}>Checks</Text>
                  {pendingOpenChecksCount > 0 ? (
                    <Text style={tableStyles.mesaActionSub}>
                      {pendingOpenChecksCount === 1
                        ? "1 sin responder"
                        : `${pendingOpenChecksCount} sin responder`}
                    </Text>
                  ) : (
                    <Text style={tableStyles.mesaActionSubMuted}>Tiradas y respuestas</Text>
                  )}
                </Pressable>
                {pendingOpenChecksCount > 0 ? (
                  <View style={tableStyles.checksBadge} accessibilityElementsHidden>
                    <Text style={tableStyles.checksBadgeText}>
                      {pendingOpenChecksCount > 99 ? "99+" : String(pendingOpenChecksCount)}
                    </Text>
                  </View>
                ) : null}
              </View>
              {(() => {
                const upgradesInteractive = chapterUpgradesOpen;
                const subLine = !chapterUpgradesOpen ? "Desactivadas por el director" : "TI · SI · MI";
                return (
                  <Pressable
                    style={[tableStyles.mesaActionBtn, !upgradesInteractive && tableStyles.mesaActionBtnDisabled]}
                    disabled={!upgradesInteractive || busy}
                    onPress={() => setUpgradesModalOpen(true)}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !upgradesInteractive || Boolean(busy) }}
                    accessibilityLabel={
                      upgradesInteractive ? "Abrir mejoras de capítulo" : "Mejoras no disponibles (desactivadas por el director)"
                    }
                  >
                    <Text style={[tableStyles.mesaActionBtnText, !upgradesInteractive && tableStyles.mesaActionBtnTextDisabled]}>
                      Mejoras
                    </Text>
                    <Text
                      style={[
                        tableStyles.mesaActionSubMuted,
                        !upgradesInteractive && tableStyles.mesaActionSubDisabled,
                      ]}
                      numberOfLines={2}
                    >
                      {subLine}
                    </Text>
                  </Pressable>
                );
              })()}
            </View>

            <View style={tableStyles.statStrip} accessibilityLabel="Estadísticas del personaje">
              {[0, 1].map((rowIdx) => (
                <View key={`stat-row-${rowIdx}`} style={tableStyles.statStripRow}>
                  {sheet.stats.slice(rowIdx * 3, rowIdx * 3 + 3).map((row) => {
                    const sk = row.stat_key as StatKey;
                    const mod = effectiveStatModifier(row.base_modifier, row.training_tier);
                    const isCheckStat = Boolean(pending?.checks && activeStat === row.stat_key);
                    const dieLabel = `d${String(row.die_size).replace(/^d/i, "")}`;
                    const iconName = STAT_ICON_NAMES[sk];
                    return (
                      <View
                        key={`stat-strip-${row.stat_key}`}
                        style={[tableStyles.statCol, isCheckStat && tableStyles.statColActive]}
                      >
                        <MaterialCommunityIcons
                          name={iconName}
                          size={46}
                          color={isCheckStat ? mesaPalette.accent : mesaPalette.textMuted}
                        />
                        <Text style={tableStyles.statColName} numberOfLines={1}>
                          {mapVisibleStatLabel(sk, row.stat_label)}
                        </Text>
                        <Text style={tableStyles.statColDie}>{dieLabel}</Text>
                        <Text style={tableStyles.statColMod}>{formatStatModifierLine(mod)}</Text>
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>

            {sessionEmail ? (
              <Text style={tableStyles.sessionHint} numberOfLines={1}>
                {sessionEmail}
              </Text>
            ) : null}
          </>
        )}

        <Pressable style={tableStyles.signOutBtn} onPress={() => void onSignOut()} disabled={busy}>
          <Text style={tableStyles.signOutText}>Cerrar sesión</Text>
        </Pressable>
      </ScrollView>

      <Modal
        visible={upgradesModalOpen && chapterUpgradesOpen && Boolean(sheet)}
        transparent={false}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setUpgradesModalOpen(false)}
      >
        <View style={tableStyles.upgradeModalBackdrop}>
          <View style={tableStyles.upgradeModalCard}>
            <View style={tableStyles.upgradeModalHead}>
              <Text style={tableStyles.panelTitle}>MEJORAS DE CAPÍTULO</Text>
              <Pressable onPress={() => setUpgradesModalOpen(false)} style={tableStyles.upgradeModalCloseBtn}>
                <Text style={tableStyles.upgradeModalCloseText}>Cerrar</Text>
              </Pressable>
            </View>
            <Text style={tableStyles.upgradeHint}>
              Solo podés comprar mientras el director tenga activadas las mejoras de capítulo. Tenés{" "}
              <Text style={tableStyles.upgradeHintStrong}>{displayTokens}</Text> fichas.
            </Text>
            {!sheet?.runtime ? (
              <Text style={tableStyles.upgradeWarn}>
                Aún no hay mesa registrada para tu personaje en esta partida; pedile al director que te asigne en la
                mesa para poder comprar.
              </Text>
            ) : null}
            <ScrollView style={tableStyles.upgradeModalList} contentContainerStyle={tableStyles.upgradeModalListInner}>
              <View style={tableStyles.upgradeTableHead}>
                <Text style={[tableStyles.upgradeTh, tableStyles.upgradeThStat]}>STAT</Text>
                <Text style={tableStyles.upgradeTh}>MOD ACTUAL</Text>
                <Text style={tableStyles.upgradeTh}>PRECIO</Text>
                <Text style={[tableStyles.upgradeTh, tableStyles.upgradeThAction]}> </Text>
              </View>
              {STAT_KEYS.map((sk) => {
                const row = statByKey.get(sk);
                const rawTier = row?.training_tier;
                const tier = rawTier && isStatTrainingTier(rawTier) ? rawTier : "none";
                const modTotal = row != null ? effectiveStatModifier(row.base_modifier, row.training_tier) : null;
                const next = nextTrainingTier(tier);
                const cost = next ? tokenCostForNextTier(next) : null;
                const canBuy =
                  Boolean(sheet?.runtime) && next != null && cost != null && displayTokens >= cost && upgradeBusyKey == null;
                const busyHere = upgradeBusyKey === sk;
                const nextLabel =
                  next === "trained_in" ? "TI" : next === "studied_in" ? "SI" : next === "master_in" ? "MI" : "?";
                const priceLine = next && cost != null ? `${cost} fichas → ${nextLabel}` : "—";
                return (
                  <View key={`up-${sk}`} style={tableStyles.upgradeTableRow}>
                    <View style={[tableStyles.upgradeTd, tableStyles.upgradeTdStat]}>
                      <Text style={tableStyles.upgradeStatName} numberOfLines={2}>
                        {mapVisibleStatLabel(sk, row?.stat_label ?? null)}
                      </Text>
                      <Text style={tableStyles.upgradeTierNow}>
                        Entreno: {trainingTierShortLabel(tier)} ({trainingTierLongLabelEs(tier)})
                      </Text>
                    </View>
                    <Text style={[tableStyles.upgradeTd, tableStyles.upgradeTdMod]}>
                      {modTotal != null ? formatStatModifierLine(modTotal) : "—"}
                    </Text>
                    <Text style={[tableStyles.upgradeTd, tableStyles.upgradeTdPrice]} numberOfLines={3}>
                      {priceLine}
                    </Text>
                    <View style={[tableStyles.upgradeTd, tableStyles.upgradeTdAction]}>
                      {next && cost != null ? (
                        <Pressable
                          style={[tableStyles.upgradeBuyBtn, (!canBuy || busyHere) && tableStyles.upgradeBuyBtnOff]}
                          disabled={!canBuy || busyHere}
                          onPress={() => void buyChapterUpgrade(sk)}
                        >
                          <Text style={tableStyles.upgradeBuyBtnText}>{busyHere ? "…" : `Comprar ${nextLabel}`}</Text>
                        </Pressable>
                      ) : (
                        <Text style={tableStyles.upgradeMax}>Máx.</Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
            <Pressable onPress={() => setUpgradesModalOpen(false)} style={tableStyles.upgradeModalFooterCloseBtn}>
              <Text style={tableStyles.upgradeModalCloseText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={checksPickerModalOpen && Boolean(sheet)}
        transparent={false}
        animationType="none"
        presentationStyle="fullScreen"
        onRequestClose={() => setChecksPickerModalOpen(false)}
      >
        <View style={tableStyles.upgradeModalBackdrop}>
          <View style={tableStyles.checkPickerCard}>
            <View style={tableStyles.upgradeModalHead}>
              <Text style={tableStyles.panelTitle}>CHECKS PENDIENTES</Text>
              <Pressable onPress={() => setChecksPickerModalOpen(false)} style={tableStyles.upgradeModalCloseBtn}>
                <Text style={tableStyles.upgradeModalCloseText}>Cerrar</Text>
              </Pressable>
            </View>
            <ScrollView style={tableStyles.upgradeModalList} contentContainerStyle={tableStyles.checkPickerListInner}>
              {pendingOpenChecks.length > 0 ? (
                pendingOpenChecks.map((row) => (
                  <Pressable
                    key={row.check_id}
                    style={tableStyles.checkPickerRow}
                    onPress={() => {
                      onSelectPendingCheck(row.check_id);
                      setChecksPickerModalOpen(false);
                      setChecksModalOpen(true);
                    }}
                    disabled={busy}
                  >
                    <Text style={tableStyles.checkPickerStat} numberOfLines={1}>
                      {row.checks?.stat_label_at_time ?? "Stat"}
                    </Text>
                    <Text style={tableStyles.checkPickerValue}>CHECK {row.checks?.check_value ?? "—"}</Text>
                  </Pressable>
                ))
              ) : (
                <Text style={tableStyles.muted}>No hay checks abiertos.</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={checksModalOpen && Boolean(sheet)}
        transparent={false}
        animationType="none"
        presentationStyle="fullScreen"
        onRequestClose={() => setChecksModalOpen(false)}
      >
        <View
          style={[
            tableStyles.upgradeModalBackdrop,
            tableStyles.checkModalBackdropLifted,
            { paddingBottom: checkModalKeyboardReserve },
          ]}
        >
          <View
            style={tableStyles.checkModalCard}
          >
            <View style={tableStyles.checkModalHead}>
              <Text style={tableStyles.checkPanelTitle}>CHECKS</Text>
              <Pressable onPress={() => setChecksModalOpen(false)} style={tableStyles.checkModalCloseBtn}>
                <Text style={tableStyles.upgradeModalCloseText}>Cerrar</Text>
              </Pressable>
            </View>
            <ScrollView
              style={[tableStyles.upgradeModalList, tableStyles.checkModalScroll]}
              contentContainerStyle={tableStyles.checkModalScrollInner}
              keyboardShouldPersistTaps="always"
              keyboardDismissMode="none"
            >
              {pending?.checks ? (
                <>
                  <Text style={tableStyles.checkSummaryLine}>
                    <Text style={tableStyles.checkSummaryStat}>{pending.checks.stat_label_at_time}</Text>
                    <Text style={tableStyles.checkSummarySep}> · </Text>
                    <Text style={tableStyles.checkSummaryQtyLabel}>CHECK </Text>
                    <Text style={tableStyles.checkSummaryQty}>{pending.checks.check_value}</Text>
                  </Text>

                  <View style={[tableStyles.checkInputsRow, tableStyles.checkInputsRowMain]}>
                    <View style={tableStyles.checkInputCell}>
                      <Text style={tableStyles.checkInputHeader}>DADO TIRADO</Text>
                      <TextInput
                        style={tableStyles.checkInputField}
                        keyboardType="number-pad"
                        autoFocus={checksModalOpen && Boolean(pending?.checks) && !busy}
                        value={rollValue}
                        onChangeText={onChangeRoll}
                        placeholder={maxDieFace ? `1–${maxDieFace}` : "—"}
                        placeholderTextColor={mesaPalette.textMuted}
                        editable={!busy}
                      />
                    </View>
                    <View style={tableStyles.checkInputCell}>
                      <Text style={tableStyles.checkInputHeader}>FICHAS USADAS</Text>
                      <TextInput
                        style={tableStyles.checkInputField}
                        keyboardType="number-pad"
                        value={tokensSpent}
                        onChangeText={onChangeTokens}
                        placeholder="0"
                        placeholderTextColor={mesaPalette.textMuted}
                        editable={!busy}
                      />
                    </View>
                    <View style={tableStyles.checkInputCell}>
                      <Text style={tableStyles.checkInputHeader}>+MOD</Text>
                      <Text style={tableStyles.checkModVal}>{mainRowModTotalLabel}</Text>
                    </View>
                  </View>

                  {explosionRows.map((exo, idx) => (
                    <View key={`exo-${idx}`} style={tableStyles.checkExoBlock}>
                      <Text style={tableStyles.checkExoTitle}>Explosión {idx + 1}</Text>
                      <View style={tableStyles.checkInputsRowTight}>
                        <View style={tableStyles.checkInputCell}>
                          <Text style={tableStyles.checkInputHeader}>DADO TIRADO</Text>
                          <TextInput
                            style={tableStyles.checkInputField}
                            keyboardType="number-pad"
                            value={exo.roll}
                            onChangeText={(v) => {
                              setExplosionRows((rows) => {
                                const copy = [...rows];
                                if (!copy[idx]) return rows;
                                copy[idx] = { ...copy[idx], roll: v };
                                return copy;
                              });
                            }}
                            placeholder={maxDieFace ? `1–${maxDieFace}` : "—"}
                            placeholderTextColor={mesaPalette.textMuted}
                            editable={!busy}
                          />
                        </View>
                        <View style={tableStyles.checkInputCell}>
                          <Text style={tableStyles.checkInputHeader}>FICHAS USADAS</Text>
                          <TextInput
                            style={tableStyles.checkInputField}
                            keyboardType="number-pad"
                            value={exo.tokens}
                            onChangeText={(v) => {
                              setExplosionRows((rows) => {
                                const copy = [...rows];
                                if (!copy[idx]) return rows;
                                copy[idx] = { ...copy[idx], tokens: v };
                                return copy;
                              });
                            }}
                            placeholder="0"
                            placeholderTextColor={mesaPalette.textMuted}
                            editable={!busy}
                          />
                        </View>
                        <View style={tableStyles.checkInputCell}>
                          <Text style={tableStyles.checkInputHeader}>+MOD</Text>
                          <Text style={tableStyles.checkModVal}>
                            {modForCheck != null && maxDieFace != null && parsedMainSeg.roll >= 1
                              ? String(
                                  cumulativeThroughExoRow(
                                    modForCheck,
                                    parsedMainSeg,
                                    parsedExtrasSeg,
                                    idx,
                                  ),
                                )
                              : "—"}
                          </Text>
                        </View>
                      </View>
                    </View>
                  ))}

                  <View style={tableStyles.resultBar}>
                    <Text style={tableStyles.resultBarText}>{outcomeBannerLine}</Text>
                  </View>

                  <TextInput
                    style={tableStyles.checkCommentInput}
                    value={checkComment}
                    onChangeText={setCheckComment}
                    placeholder="Comentario (opcional)"
                    placeholderTextColor={mesaPalette.textMuted}
                    multiline
                    editable={!busy}
                  />
                </>
              ) : (
                <Text style={tableStyles.muted}>No hay check abierto para vos ahora.</Text>
              )}
            </ScrollView>
            {pending?.checks ? (
              <View style={tableStyles.checkModalFooter}>
                <Pressable style={tableStyles.termPrimary} onPress={() => void submitCheck()} disabled={busy}>
                  <Text style={tableStyles.termPrimaryText}>{busy ? "…" : "Enviar respuesta"}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const tableStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: mesaPalette.bg },
  scroll: { padding: 16, paddingTop: 44, paddingBottom: 32 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
    borderBottomWidth: 2,
    borderBottomColor: mesaPalette.borderDim,
    paddingBottom: 10,
  },
  topBarTitle: { fontSize: 13, fontWeight: "800", letterSpacing: 4, color: mesaPalette.textBright },
  topBarBtn: { paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: mesaPalette.border },
  topBarSpacer: { width: 76 },
  topBarBtnText: { color: mesaPalette.text, fontSize: 12, fontWeight: "700" },
  errText: { color: "#fecaca", marginBottom: 8 },
  heroFrame: {
    paddingVertical: 6,
    paddingHorizontal: 0,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  heroSideSpacer: { minWidth: 76 },
  heroIdentityBlock: { flex: 1, alignItems: "center" },
  heroTokensBlock: { alignItems: "center", minWidth: 76, marginTop: 10, marginLeft: -6 },
  heroTokensLabel: { fontSize: 10, fontWeight: "800", color: mesaPalette.textMuted, letterSpacing: 2 },
  heroTokensBig: { fontSize: 28, fontWeight: "800", color: mesaPalette.accent, marginTop: 4 },
  portraitRing: {
    width: 112,
    height: 112,
    borderWidth: 3,
    borderColor: mesaPalette.border,
    padding: 3,
    backgroundColor: mesaPalette.bg,
  },
  portraitImg: { width: 98, height: 98 },
  portraitFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: mesaPalette.panel,
  },
  portraitFallbackGlyph: { fontSize: 36, color: mesaPalette.border },
  namePlate: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: mesaPalette.borderDim,
    paddingVertical: 6,
    paddingHorizontal: 12,
    width: "100%",
    maxWidth: 240,
  },
  nameText: { textAlign: "center", fontSize: 16, fontWeight: "800", color: mesaPalette.textBright, letterSpacing: 1 },
  mesaActionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
    width: "100%",
  },
  mesaActionBtnWrap: {
    flex: 1,
    minWidth: 0,
    position: "relative",
  },
  mesaActionBtn: {
    flex: 1,
    minWidth: 0,
    borderWidth: 2,
    borderColor: mesaPalette.borderDim,
    backgroundColor: mesaPalette.panel,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  mesaActionBtnEmphasis: {
    borderColor: mesaPalette.border,
    backgroundColor: "rgba(102, 255, 102, 0.08)",
  },
  mesaActionBtnText: {
    color: mesaPalette.accent,
    fontWeight: "900",
    fontSize: 14,
    letterSpacing: 1,
  },
  mesaActionSub: {
    marginTop: 4,
    fontSize: 10,
    fontWeight: "700",
    color: mesaPalette.accent,
    textAlign: "center",
  },
  mesaActionSubMuted: {
    marginTop: 4,
    fontSize: 10,
    fontWeight: "600",
    color: mesaPalette.textMuted,
    textAlign: "center",
  },
  /** Mismo tamaño que `mesaActionBtn`; el director desactivó mejoras (`chapter_upgrades_open`). */
  mesaActionBtnDisabled: {
    opacity: 0.42,
    borderColor: "rgba(102, 255, 102, 0.12)",
    backgroundColor: "rgba(8, 8, 8, 0.92)",
  },
  mesaActionBtnTextDisabled: {
    color: "rgba(102, 255, 102, 0.38)",
  },
  mesaActionSubDisabled: {
    color: "rgba(102, 255, 102, 0.32)",
  },
  checksBadge: {
    position: "absolute",
    top: -8,
    right: -6,
    minWidth: 24,
    height: 24,
    paddingHorizontal: 7,
    borderRadius: 12,
    backgroundColor: mesaPalette.accent,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: mesaPalette.bg,
  },
  checksBadgeText: {
    color: "#050805",
    fontSize: 12,
    fontWeight: "900",
  },
  /** Contenedor: 2 filas fijas (`statStripRow`) × 3 columnas. */
  statStrip: {
    flexDirection: "column",
    gap: 12,
    marginTop: 12,
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: mesaPalette.borderDim,
    backgroundColor: mesaPalette.panel,
  },
  statStripRow: {
    flexDirection: "row",
    alignItems: "stretch",
    justifyContent: "space-between",
    gap: 8,
  },
  statCol: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "transparent",
  },
  statColActive: {
    borderColor: mesaPalette.border,
    backgroundColor: "rgba(102, 255, 102, 0.08)",
  },
  statColName: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: "800",
    color: mesaPalette.textBright,
    textAlign: "center",
    letterSpacing: 0.2,
  },
  statColDie: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: "800",
    color: mesaPalette.accent,
  },
  statColMod: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: "700",
    color: mesaPalette.textMuted,
  },
  upgradeHint: {
    fontSize: 10,
    color: mesaPalette.textMuted,
    marginBottom: 10,
    lineHeight: 14,
  },
  upgradeHintStrong: { color: mesaPalette.accent, fontWeight: "800" },
  upgradeWarn: {
    fontSize: 10,
    color: mesaPalette.warn,
    marginBottom: 10,
    lineHeight: 14,
  },
  upgradeTableHead: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingBottom: 6,
    marginBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: mesaPalette.border,
    gap: 4,
  },
  upgradeTh: {
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.5,
    color: mesaPalette.textMuted,
    flex: 1,
    minWidth: 0,
  },
  upgradeThStat: { flex: 1.35 },
  upgradeThAction: { flex: 1.15, minWidth: 72 },
  upgradeTableRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 4,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: mesaPalette.borderDim,
  },
  upgradeTd: { justifyContent: "center", minWidth: 0 },
  upgradeTdStat: { flex: 1.35 },
  upgradeTdMod: {
    flex: 0.75,
    textAlign: "center",
    fontSize: 12,
    fontWeight: "800",
    color: mesaPalette.textBright,
  },
  upgradeTdPrice: { flex: 1, fontSize: 10, color: mesaPalette.text, lineHeight: 13 },
  upgradeTdAction: { flex: 1.15, minWidth: 72, justifyContent: "center" },
  upgradeStatName: { fontSize: 12, fontWeight: "800", color: mesaPalette.textBright },
  upgradeTierNow: { fontSize: 9, color: mesaPalette.textMuted, marginTop: 3, lineHeight: 12 },
  upgradeBuyBtn: {
    borderWidth: 1,
    borderColor: mesaPalette.border,
    paddingVertical: 6,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  upgradeBuyBtnOff: { opacity: 0.45 },
  upgradeBuyBtnText: { color: mesaPalette.accent, fontWeight: "800", fontSize: 10, textAlign: "center" },
  upgradeMax: { fontSize: 10, fontWeight: "700", color: mesaPalette.textMuted, textAlign: "center" },
  upgradeModalBackdrop: {
    flex: 1,
    backgroundColor: "#000000",
    justifyContent: "center",
    alignItems: "center",
    padding: 14,
  },
  upgradeModalCard: {
    width: "100%",
    maxWidth: 620,
    maxHeight: "85%",
    borderWidth: 2,
    borderColor: mesaPalette.border,
    backgroundColor: mesaPalette.panel,
    padding: 12,
  },
  upgradeModalHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  upgradeModalCloseBtn: {
    borderWidth: 1,
    borderColor: mesaPalette.border,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  upgradeModalCloseText: { color: mesaPalette.textBright, fontSize: 12, fontWeight: "700" },
  upgradeModalList: { marginTop: 4 },
  upgradeModalListInner: { paddingBottom: 8 },
  upgradeModalFooterCloseBtn: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: mesaPalette.border,
    paddingVertical: 10,
    alignItems: "center",
  },
  sessionHint: { marginTop: 10, fontSize: 10, color: mesaPalette.textMuted, textAlign: "center" },
  checkModalScroll: { marginTop: 0 },
  checkModalScrollInner: { paddingBottom: 16, paddingTop: 2 },
  checkPickerCard: {
    width: "100%",
    maxWidth: 620,
    maxHeight: "75%",
    borderWidth: 2,
    borderColor: mesaPalette.border,
    borderRadius: 16,
    backgroundColor: "#050805",
    padding: 12,
  },
  checkPickerListInner: { paddingBottom: 10, gap: 8 },
  checkPickerRow: {
    borderWidth: 1,
    borderColor: mesaPalette.borderDim,
    borderRadius: 10,
    backgroundColor: "rgba(10, 16, 10, 0.84)",
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  checkPickerStat: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: "800",
    color: mesaPalette.textBright,
  },
  checkPickerValue: {
    fontSize: 14,
    fontWeight: "900",
    color: mesaPalette.accent,
  },
  checkModalCard: {
    width: "100%",
    maxWidth: 620,
    flex: 1,
    borderWidth: 2,
    borderColor: mesaPalette.border,
    borderRadius: 16,
    backgroundColor: "#050805",
    padding: 14,
  },
  checkModalBackdropLifted: {
    justifyContent: "flex-start",
    paddingTop: "20%",
    paddingBottom: 0,
  },
  checkModalHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  checkModalCloseBtn: {
    borderWidth: 1,
    borderColor: mesaPalette.border,
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 12,
    backgroundColor: "rgba(102, 255, 102, 0.05)",
  },
  checkModalFooter: {
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: mesaPalette.borderDim,
  },
  checkPanelTitle: { fontSize: 12, fontWeight: "900", letterSpacing: 3, color: mesaPalette.textMuted, marginBottom: 6 },
  panelTitle: { fontSize: 11, fontWeight: "900", letterSpacing: 2, color: mesaPalette.textMuted, marginBottom: 10 },
  checkSummaryLine: {
    marginBottom: 14,
    fontSize: 16,
    lineHeight: 22,
    textAlign: "center",
    width: "100%",
  },
  checkSummaryStat: { fontWeight: "800", color: mesaPalette.textBright },
  checkSummarySep: { color: mesaPalette.textMuted, fontWeight: "600" },
  checkSummaryQtyLabel: { fontWeight: "700", color: mesaPalette.text },
  checkSummaryQty: { fontWeight: "900", color: mesaPalette.accent },
  checkInputsRowMain: { marginTop: 0 },
  checkCommentInput: {
    marginTop: 12,
    minHeight: 72,
    borderWidth: 1,
    borderColor: mesaPalette.borderDim,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: mesaPalette.textBright,
    backgroundColor: "rgba(10, 16, 10, 0.9)",
    textAlignVertical: "top",
  },
  checkExoBlock: { marginTop: 12 },
  checkExoTitle: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    color: mesaPalette.textMuted,
    marginBottom: 6,
  },
  checkInputsRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 8,
    marginTop: 12,
  },
  checkInputsRowTight: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 8,
    marginTop: 0,
  },
  checkInputCell: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderColor: mesaPalette.borderDim,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 6,
    backgroundColor: "rgba(10, 16, 10, 0.78)",
  },
  checkInputHeader: {
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
    color: mesaPalette.textMuted,
    textAlign: "center",
    marginBottom: 8,
  },
  checkInputField: {
    borderWidth: 1,
    borderColor: mesaPalette.borderDim,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 4,
    fontSize: 17,
    fontWeight: "800",
    color: mesaPalette.textBright,
    backgroundColor: mesaPalette.panel,
    textAlign: "center",
  },
  checkModVal: {
    borderWidth: 1,
    borderColor: mesaPalette.borderDim,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 4,
    fontSize: 17,
    fontWeight: "800",
    color: mesaPalette.textBright,
    backgroundColor: mesaPalette.panel,
    textAlign: "center",
    overflow: "hidden",
  },
  termPrimary: {
    marginTop: 14,
    borderWidth: 2,
    borderColor: mesaPalette.border,
    borderRadius: 12,
    backgroundColor: "rgba(102, 255, 102, 0.12)",
    paddingVertical: 14,
    alignItems: "center",
  },
  termPrimaryText: { color: mesaPalette.accent, fontSize: 15, fontWeight: "900", letterSpacing: 1 },
  resultBar: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: mesaPalette.borderDim,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "rgba(10, 16, 10, 0.72)",
  },
  resultBarText: { color: mesaPalette.accent, fontWeight: "800", fontSize: 13 },
  muted: { color: mesaPalette.textMuted, fontSize: 13, marginTop: 8 },
  signOutBtn: { marginTop: 28, alignSelf: "center", paddingVertical: 10, paddingHorizontal: 16 },
  signOutText: { color: mesaPalette.textMuted, fontSize: 12, textDecorationLine: "underline" },
});
