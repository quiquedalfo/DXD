# Flujo MVP end-to-end (especificación → implementación)

Objetivo: **master crea partida → jugador entra → master lanza check → jugador responde → master ve resultado**.

## Alineación con el repo desktop (Python)

- Las **6 claves** coinciden con `core.models.STAT_KEYS` (mismo conjunto).
- **Explosión**: el documento original usa `roll_value >= die_size`; el desktop usa `roll_value + tokens_spent === die_max` (`core/dice.py`). La RPC `submit_check_response` acepta `p_explosion_mode := 'spec' | 'desktop'`.

## RPCs en Postgres (migración `20260413140000_rpc_join_match_submit_check.sql`)

| Función | Quién la llama | Qué hace |
|--------|----------------|----------|
| `create_match(p_title, p_code default null)` | Master autenticado | Inserta `matches` en `draft`, código único (propio ≥3 chars o autogen 6 hex), fila `match_members` rol `master`, evento `match_created`. |
| `join_match_with_code(p_code)` | Cualquier usuario autenticado | Busca partida por código (case-insensitive trim). Si `auth.uid()` es el master, asegura fila `match_members` master; si no, inserta `player`. Idempotente. Estados permitidos: `draft`, `live`, `paused`. |
| `submit_check_response(p_check_id, p_character_id, p_roll_value, p_tokens_spent, p_modifier_applied, p_explosion_mode)` | Jugador target | Valida check abierto, target pendiente, asignación activa, flags de fichas/mod, stats; escribe `check_responses`; marca target `submitted`; actualiza `character_runtime` (fichas, último resultado, `check_status = responded`); si no quedan targets `pending`, pone el check en `answered`; inserta `match_events`. |

Todas son **`SECURITY DEFINER`** con `search_path = public` y `GRANT EXECUTE` a `authenticated`. Errores: excepciones con mensaje claro (`invalid_code`, `check_not_open`, etc.).

### Llamadas desde TypeScript

En `@dxd/shared`: `rpcCreateMatch`, `rpcJoinMatchByCode`, `rpcSubmitCheckResponse` (`packages/shared/src/rpc/client.ts`).

## Pendiente fuera de SQL (apps)

1. **Master crea check + targets**: sigue siendo inserción desde cliente con RLS (master) o una RPC futura `create_check` para transacción única.
2. **Asignar personaje + `character_runtime`**: el master inserta `match_characters` y debe crear/actualizar fila en `character_runtime` (hoy solo el master puede, vía políticas RLS).
3. **Realtime**: suscribirse a `check_responses`, `checks`, `match_events` por `match_id`.

## Orden sugerido en UI

1. Aplicar migraciones en Supabase.
2. Master: `create_match` → comparte código.
3. Jugador: `join_match_with_code`.
4. Master: asigna personaje + runtime.
5. Master: inserta `checks` + `check_targets`.
6. Jugador: `submit_check_response` al cargar el dado real.
7. Master: ve filas nuevas por Realtime o refetch.
