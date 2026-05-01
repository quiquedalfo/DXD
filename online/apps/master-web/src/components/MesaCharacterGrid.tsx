"use client";

import { useCallback, useEffect, useState } from "react";
import type { MatchMemberSheetRow } from "@dxd/shared";
import Icon from "@mdi/react";
import {
  mdiArmFlex,
  mdiBrain,
  mdiEmoticonKiss,
  mdiShieldOutline,
  mdiSnake,
  mdiSwordCross,
} from "@mdi/js";
import { DiceBadge } from "@/components/DiceBadge";

export type MesaPendingInvite = {
  id: string;
  createdAt: string;
  displayLabel: string;
};

export type CharacterStatPreview = {
  statKey: string;
  dieSize: string;
  modifier: number;
};

const STAT_ICON_PATHS: Record<string, string> = {
  brains: mdiBrain,
  brawn: mdiArmFlex,
  charm: mdiEmoticonKiss,
  fight: mdiSwordCross,
  flight: mdiSnake,
  grit: mdiShieldOutline,
};

/** Solo si hay `last_seen_at` reciente del latido: si falta timestamp pero el enum es online, confiamos en online (evita falsos «Desconectado»). */
const PRESENCE_STALE_MS = 150_000;

function formatSeen(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return null;
  }
}

function isOnlineStale(row: MatchMemberSheetRow): boolean {
  const raw = row.connection_status ?? "offline";
  if (raw !== "online") return false;
  const t = row.last_seen_at;
  if (!t) return false;
  const ms = Date.parse(t);
  if (!Number.isFinite(ms)) return false;
  return Date.now() - ms > PRESENCE_STALE_MS;
}

/** Presencia con `connection_status` + `last_seen_at` (latido móvil); sin latido reciente → desconectado. */
function statusForRow(row: MatchMemberSheetRow): { label: string; className: string; subtitle?: string } {
  const presence = isOnlineStale(row) ? "offline" : (row.connection_status ?? "offline");
  const hasChar = Boolean(row.character_id);
  const seen = formatSeen(row.last_seen_at);

  if (presence === "online" && hasChar) {
    return {
      label: "En mesa",
      className: "mesa-card__pill mesa-card__pill--mesa",
      subtitle: seen ? `Actividad ${seen}` : undefined,
    };
  }
  if (presence === "online" && !hasChar) {
    return {
      label: "En la app",
      className: "mesa-card__pill mesa-card__pill--online",
      subtitle: "Sin personaje elegido",
    };
  }
  if (hasChar) {
    return {
      label: "Desconectado",
      className: "mesa-card__pill mesa-card__pill--away",
      subtitle: seen ? `Última señal ${seen}` : "Sin señal de presencia (app cerrada o sin latido)",
    };
  }
  return {
    label: "Esperando hoja",
    className: "mesa-card__pill mesa-card__pill--wait",
    subtitle: seen ? `Última señal ${seen}` : undefined,
  };
}

/** En el popup de ficha: azul = strength inicial de creación; verde = comprada después */
type StrengthPurchaseMark = "none" | "initial" | "purchased";

type StrengthSheetLine = { label: string; mark: StrengthPurchaseMark };

function renderStrengthParen(mark: StrengthPurchaseMark) {
  const inner =
    mark === "none" ? (
      <span className="mesa-detail-sheet__strength-empty"> </span>
    ) : (
      <span
        className={
          mark === "initial"
            ? "mesa-detail-sheet__strength-x mesa-detail-sheet__strength-x--initial"
            : "mesa-detail-sheet__strength-x mesa-detail-sheet__strength-x--purchased"
        }
      >
        X
      </span>
    );
  return (
    <span className="mesa-detail-sheet__strength-paren" aria-hidden>
      ({inner})
    </span>
  );
}

function Avatar({ url, alt }: { url: string | null | undefined; alt: string }) {
  const [broken, setBroken] = useState(false);
  const trimmed = url?.trim();
  if (trimmed && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="mesa-card__avatar-img"
        src={trimmed}
        alt={alt}
        onError={() => setBroken(true)}
      />
    );
  }
  return <div className="mesa-card__avatar-fallback" aria-hidden>👤</div>;
}

type CardProps = {
  row: MatchMemberSheetRow;
  masterUserId: string;
  kickingUserId: string | null;
  onKickMember?: (memberUserId: string) => void;
  selectableForCheck?: boolean;
  checkTargetSelected?: boolean;
  onToggleCheckTarget?: (characterId: string) => void;
  onAdjustTokens?: (characterId: string, displayName: string, delta: number) => void;
  statsByCharacterId?: Record<string, CharacterStatPreview[]>;
  onOpenDetails?: (row: MatchMemberSheetRow) => void;
};

function MesaCard({
  row,
  masterUserId,
  kickingUserId,
  onKickMember,
  selectableForCheck,
  checkTargetSelected,
  onToggleCheckTarget,
  onAdjustTokens,
  statsByCharacterId,
  onOpenDetails,
}: CardProps) {
  const presenceBadge = statusForRow(row);
  const isBlank = row.member_role === "blank";
  const charName = row.character_name?.trim() || (row.character_id ? "Sin nombre" : null);
  const canKick = Boolean(onKickMember) && !isBlank && row.member_user_id !== masterUserId;
  const kicking = kickingUserId === row.member_user_id;
  const cid = row.character_id?.trim() ?? "";
  const canSelect = Boolean(selectableForCheck && cid && onToggleCheckTarget);
  const runtimeTokens = typeof row.runtime_tokens === "number" ? row.runtime_tokens : null;
  const statRows = cid ? statsByCharacterId?.[cid] ?? [] : [];

  return (
    <article
      className={[
        "mesa-card",
        canSelect ? "mesa-card--selectable" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={(e) => {
        const t = e.target as HTMLElement;
        if (
          t.closest("button.mesa-card__kick") ||
          t.closest("button.mesa-card__grant") ||
          t.closest("button.mesa-card__token-step")
        )
          return;
        if (!isBlank) {
          onOpenDetails?.(row);
          return;
        }
        if (canSelect) {
          onToggleCheckTarget?.(cid);
          return;
        }
      }}
      onKeyDown={
        canSelect || (!isBlank && Boolean(onOpenDetails))
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (!isBlank) onOpenDetails?.(row);
                else if (canSelect) onToggleCheckTarget?.(cid);
              }
            }
          : undefined
      }
      role={canSelect || (!isBlank && Boolean(onOpenDetails)) ? "button" : undefined}
      tabIndex={canSelect || (!isBlank && Boolean(onOpenDetails)) ? 0 : undefined}
      aria-pressed={isBlank && canSelect ? checkTargetSelected : undefined}
    >
      <h3 className="mesa-card__char-name">{charName ?? "—"}</h3>
      <div className="mesa-card__top">
        <Avatar url={row.avatar_url} alt={charName ?? row.owner_display} />
        <div className="mesa-card__headtext">
          <div className="mesa-card__title-row">
            <span className="mesa-card__pill mesa-card__pill--type">
              {isBlank
                ? "NPC"
                : row.character_origin === "master_pet"
                  ? "PET"
                  : "Jugador"}
            </span>
            <span className={presenceBadge.className}>{presenceBadge.label}</span>
          </div>
        </div>
      </div>
      {cid && onAdjustTokens ? (
        <div className="mesa-card__tokens">
          <button
            type="button"
            className="mesa-card__token-step"
            disabled={runtimeTokens == null || runtimeTokens <= 0}
            onClick={(e) => {
              e.stopPropagation();
              onAdjustTokens(cid, charName ?? row.owner_display?.trim() ?? "Personaje", -1);
            }}
          >
            -
          </button>
          <span className="mesa-card__tokens-value">Fichas: {runtimeTokens ?? "—"}</span>
          <button
            type="button"
            className="mesa-card__grant"
            onClick={(e) => {
              e.stopPropagation();
              onAdjustTokens(cid, charName ?? row.owner_display?.trim() ?? "Personaje", 1);
            }}
          >
            +
          </button>
        </div>
      ) : null}
      {statRows.length > 0 ? (
        <ul className="mesa-card__stat-list">
          {statRows.map((st) => (
            <li key={st.statKey} className="mesa-card__stat-item">
              <span className="mesa-card__stat-icon-wrap" title={st.statKey}>
                <Icon path={STAT_ICON_PATHS[st.statKey] ?? mdiShieldOutline} size="0.95rem" aria-hidden />
              </span>
              <span className="mesa-card__stat-mod">
                <DiceBadge dieSizeRaw={st.dieSize} className="mesa-card__stat-dice" />
                <span className="mesa-card__stat-mod-num">{st.modifier >= 0 ? `+${st.modifier}` : st.modifier}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {canKick ? (
        <div className="mesa-card__actions">
          <button
            type="button"
            className="mesa-card__kick"
            disabled={kicking}
            onClick={() => onKickMember?.(row.member_user_id)}
          >
            {kicking ? "Sacando…" : "Sacar de la mesa"}
          </button>
        </div>
      ) : null}
    </article>
  );
}

function PendingInviteCard({ inv }: { inv: MesaPendingInvite }) {
  return (
    <article className="mesa-card mesa-card--invite">
      <div className="mesa-card__top">
        <div className="mesa-card__avatar-fallback mesa-card__avatar-fallback--invite" aria-hidden>
          ✉
        </div>
        <div className="mesa-card__headtext">
          <div className="mesa-card__title-row">
            <h3 className="mesa-card__char-name mesa-card__char-name--invite">{inv.displayLabel}</h3>
            <span className="mesa-card__pill mesa-card__pill--invite">Invitado</span>
          </div>
          <p className="mesa-card__player">Pendiente de aceptar en el celular</p>
          <p className="mesa-card__status-sub">
            Enviada{" "}
            {new Date(inv.createdAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}
          </p>
        </div>
      </div>
    </article>
  );
}

type Props = {
  rows: MatchMemberSheetRow[];
  masterUserId: string;
  kickingUserId: string | null;
  onKickMember?: (memberUserId: string) => void;
  pendingInvites?: MesaPendingInvite[];
  checkTargetCharacterIds?: string[];
  onToggleCheckTarget?: (characterId: string) => void;
  onAdjustTokens?: (characterId: string, displayName: string, delta: number) => void;
  statsByCharacterId?: Record<string, CharacterStatPreview[]>;
  entityLabelSingular?: string;
  entityLabelPlural?: string;
};

export function MesaCharacterGrid({
  rows,
  masterUserId,
  kickingUserId,
  onKickMember,
  pendingInvites = [],
  checkTargetCharacterIds = [],
  onToggleCheckTarget,
  onAdjustTokens,
  statsByCharacterId = {},
  entityLabelSingular = "jugador",
  entityLabelPlural = "jugadores",
}: Props) {
  const [copied, setCopied] = useState(false);
  const [detailRow, setDetailRow] = useState<MatchMemberSheetRow | null>(null);
  const playerRows = rows.filter((r) => r.member_role !== "blank");
  const blankRows = rows.filter((r) => r.member_role === "blank");

  useEffect(() => {
    if (!detailRow) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetailRow(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailRow]);

  const copySummary = useCallback(async () => {
    try {
      const text = rows
        .map((r) => `${r.owner_display}: ${r.character_name?.trim() || (r.character_id ? "Sin nombre" : "—")}`)
        .join("\n");
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [rows]);

  const totalPeople = rows.length + pendingInvites.length;
  if (totalPeople === 0) {
    return <p className="mesa-grid__empty">No hay jugadores ni invitaciones pendientes en esta mesa todavía.</p>;
  }

  return (
    <div className="mesa-grid-wrap">
      <div className="mesa-grid-toolbar">
        <span className="mesa-grid-toolbar__label">
          {playerRows.length} {playerRows.length === 1 ? entityLabelSingular : entityLabelPlural}
          {blankRows.length > 0 ? ` · ${blankRows.length} NPC` : ""}
          {pendingInvites.length > 0
            ? ` · ${pendingInvites.length} invitación${pendingInvites.length === 1 ? "" : "es"}`
            : ""}
        </span>
        <button type="button" className="mesa-toolbar-copy" onClick={() => void copySummary()}>
          Copiar listado
        </button>
        {copied ? <span className="mesa-grid-toolbar__ok">Copiado</span> : null}
      </div>
      <div className={`mesa-split${blankRows.length === 0 ? " mesa-split--single" : ""}`}>
        <section className="mesa-split__section">
          <h4 className="mesa-split__title">Personajes</h4>
          <div className="mesa-grid">
            {pendingInvites.map((inv) => (
              <PendingInviteCard key={`inv-${inv.id}`} inv={inv} />
            ))}
            {playerRows.map((row) => {
              const cid = row.character_id?.trim() ?? "";
              return (
                <MesaCard
                  key={row.member_user_id}
                  row={row}
                  masterUserId={masterUserId}
                  kickingUserId={kickingUserId}
                  onKickMember={onKickMember}
                  selectableForCheck={Boolean(onToggleCheckTarget)}
                  checkTargetSelected={Boolean(cid && checkTargetCharacterIds.includes(cid))}
                  onToggleCheckTarget={onToggleCheckTarget}
                  onAdjustTokens={onAdjustTokens}
                  statsByCharacterId={statsByCharacterId}
                  onOpenDetails={setDetailRow}
                />
              );
            })}
          </div>
        </section>
        {blankRows.length > 0 ? <div className="mesa-split__divider" aria-hidden /> : null}
        {blankRows.length > 0 ? (
          <section className="mesa-split__section">
            <h4 className="mesa-split__title">NPC</h4>
            <div className="mesa-grid">
              {blankRows.map((row) => {
                const cid = row.character_id?.trim() ?? "";
                return (
                  <MesaCard
                    key={row.member_user_id}
                    row={row}
                    masterUserId={masterUserId}
                    kickingUserId={kickingUserId}
                    onKickMember={onKickMember}
                    selectableForCheck={Boolean(onToggleCheckTarget)}
                    checkTargetSelected={Boolean(cid && checkTargetCharacterIds.includes(cid))}
                    onToggleCheckTarget={onToggleCheckTarget}
                    onAdjustTokens={onAdjustTokens}
                    statsByCharacterId={statsByCharacterId}
                  />
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
      {detailRow ? (
        <div className="match-modal-overlay" role="presentation" onClick={() => setDetailRow(null)}>
          <div
            className="match-modal mesa-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Información del personaje"
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const name = detailRow.character_name?.trim() || "Sin nombre";
              const player = detailRow.owner_display?.trim() || "—";
              const status = statusForRow(detailRow).label;
              const tokens = typeof detailRow.runtime_tokens === "number" ? detailRow.runtime_tokens : null;
              const cid = detailRow.character_id?.trim() ?? "";
              const statRows = cid ? statsByCharacterId[cid] ?? [] : [];
              /* Placeholder visual; orden según Planilla 1 SXS / Planilla 2 SXS */
              const strengths1: StrengthSheetLine[] = [
                { label: "Cool Under Pressure", mark: "initial" },
                { label: "Gross", mark: "none" },
                { label: "Prepared", mark: "none" },
                { label: "Rebellious", mark: "none" },
                { label: "Tough", mark: "none" },
                { label: "Treasure Hunter", mark: "none" },
                { label: "Unassuming", mark: "none" },
                { label: "Wealthy", mark: "none" },
                { label: "Quick Healing", mark: "purchased" },
                { label: "Innocence", mark: "none" },
                { label: "Trained in...", mark: "none" },
                { label: "Studied in...", mark: "none" },
                { label: "Master of...", mark: "none" },
                { label: "Wild Speak", mark: "none" },
              ];
              const strengths2: StrengthSheetLine[] = [
                { label: "Heroic", mark: "none" },
                { label: "Intuitive", mark: "none" },
                { label: "Lucky", mark: "none" },
                { label: "By the Book", mark: "none" },
                { label: "Poker Face", mark: "none" },
                { label: "Protector", mark: "none" },
                { label: "Duelist", mark: "none" },
                { label: "Stealthy", mark: "none" },
                { label: "Inspiring", mark: "none" },
                { label: "Suspicious", mark: "none" },
                { label: "Martial Artist", mark: "none" },
                { label: "Help", mark: "none" },
              ];
              /** true = herida activa (X roja); luego vendrá de datos reales */
              const woundLeveActive = [true, false, false];
              const woundSeveraActive = [false, false];
              const woundMortalActive = [false];
              const renderWoundMarks = (activeFlags: boolean[]) =>
                activeFlags.map((active, i) => (
                  <span
                    key={i}
                    className={`mesa-detail-sheet__wound-x${active ? " mesa-detail-sheet__wound-x--active" : ""}`}
                    aria-hidden
                  >
                    X
                  </span>
                ));
              return (
                <>
                  <div className="mesa-detail-sheet">
                    <div className="mesa-detail-sheet__left">
                      <div className="mesa-detail-sheet__portrait-wrap">
                        <Avatar url={detailRow.avatar_url} alt={name} />
                      </div>
                      <h3 className="mesa-detail-sheet__name">{name}</h3>
                    </div>
                    <div className="mesa-detail-sheet__right">
                      <div className="mesa-detail-sheet__meta">
                        <span><strong>Jugador:</strong> {player}</span>
                        <span><strong>Estado:</strong> {status}</span>
                        <span><strong>Fichas:</strong> {tokens ?? "—"}</span>
                      </div>
                      <div className="mesa-detail-sheet__stats">
                        {statRows.length > 0 ? (
                          statRows.map((st) => (
                            <div key={`${cid}-${st.statKey}`} className="mesa-detail-sheet__stat-chip">
                              <span className="mesa-detail-sheet__stat-name">{st.statKey.toUpperCase()}</span>
                              <DiceBadge dieSizeRaw={st.dieSize} className="mesa-detail-sheet__stat-dice" />
                              <span className="mesa-detail-sheet__stat-mod">{st.modifier >= 0 ? `+${st.modifier}` : st.modifier}</span>
                            </div>
                          ))
                        ) : (
                          <span className="mesa-detail-sheet__muted">Sin stats cargados</span>
                        )}
                      </div>
                      <div className="mesa-detail-sheet__strengths-grid">
                        <section className="mesa-detail-sheet__block">
                          <h4>STRENGTHS I</h4>
                          <ul className="mesa-detail-sheet__strength-list">
                            {strengths1.map((line) => (
                              <li key={line.label} className="mesa-detail-sheet__strength-item">
                                <span className="mesa-detail-sheet__strength-name">{line.label}</span>
                                <span className="mesa-detail-sheet__strength-dots" aria-hidden />
                                {renderStrengthParen(line.mark)}
                              </li>
                            ))}
                          </ul>
                        </section>
                        <section className="mesa-detail-sheet__block">
                          <h4>STRENGTHS II</h4>
                          <ul className="mesa-detail-sheet__strength-list">
                            {strengths2.map((line) => (
                              <li key={line.label} className="mesa-detail-sheet__strength-item">
                                <span className="mesa-detail-sheet__strength-name">{line.label}</span>
                                <span className="mesa-detail-sheet__strength-dots" aria-hidden />
                                {renderStrengthParen(line.mark)}
                              </li>
                            ))}
                          </ul>
                        </section>
                      </div>
                      <div className="mesa-detail-sheet__wounds-table" role="group" aria-label="Heridas">
                        <div className="mesa-detail-sheet__wounds-title">HERIDAS</div>
                        <div className="mesa-detail-sheet__wound-head">LEVE (1 SEMANA)</div>
                        <div className="mesa-detail-sheet__wound-head">SEVERA (1 MES)</div>
                        <div className="mesa-detail-sheet__wound-head">MORTAL</div>
                        <div className="mesa-detail-sheet__wound-body">
                          {renderWoundMarks(woundLeveActive)}
                        </div>
                        <div className="mesa-detail-sheet__wound-body">
                          {renderWoundMarks(woundSeveraActive)}
                        </div>
                        <div className="mesa-detail-sheet__wound-body">
                          {renderWoundMarks(woundMortalActive)}
                        </div>
                      </div>
                      <div className="mesa-detail-sheet__specials">
                        {["TEN", "REN", "ZETSU", "HATSU"].map((k) => (
                          <div key={k} className="mesa-detail-sheet__special">
                            <span>{k}</span>
                            <span>No activo</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              );
            })()}
            <div className="match-modal__actions">
              <button type="button" className="secondary" onClick={() => setDetailRow(null)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
