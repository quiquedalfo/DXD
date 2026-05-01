import type { JsonObject, MatchEventRow } from "../types/index.js";

export type NewMatchEvent = Omit<MatchEventRow, "id" | "created_at"> & {
  created_at?: string;
};

/**
 * Construye un registro de bitácora (la inserción real va contra Supabase / RPC).
 */
export function appendMatchEvent(input: {
  matchId: string;
  actorUserId: string | null;
  eventType: string;
  entityType?: string | null;
  entityId?: string | null;
  payload: JsonObject;
}): NewMatchEvent {
  return {
    match_id: input.matchId,
    actor_user_id: input.actorUserId,
    event_type: input.eventType,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    payload_json: input.payload,
  };
}
