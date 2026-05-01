# Cómo visualizar y probar el stack online

Hay dos cosas distintas: **ver datos en Supabase** (sin app móvil/web todavía) y **ejecutar el flujo** contra la API real.

## Si “no ves nada”

1. **Table Editor** (menú izquierdo) → arriba elegí esquema **`public`** (no solo `auth` / `storage`). Las tablas nuevas están en `public`.
2. Tablas **vacías** es normal: recién crean estructura; filas aparecen después del `npm run smoke` o al insertar datos.
3. Si **no aparecen tablas** en `public`, el SQL seguramente falló: en SQL Editor abrí **History** (historial de consultas) y buscá el run en rojo / mensaje de error.
4. Pegá y ejecutá `supabase/diagnostics.sql`: si `tablas_dxds` da **0**, volvé a ejecutar la migración inicial (idealmente en proyecto vacío o tras borrar objetos conflictivos).

**Nota:** si al pegar el primer script viste error de sintaxis en triggers, actualizá el archivo local a la versión que usa `EXECUTE PROCEDURE` y volvé a pegarlo.

## 1. Proyecto en Supabase

1. Entrá a [supabase.com](https://supabase.com), creá un proyecto nuevo.
2. **SQL Editor** → pegá y ejecutá **en orden**:
   - `supabase/migrations/20260413120000_initial_schema.sql`
   - `supabase/migrations/20260413140000_rpc_join_match_submit_check.sql`  
   Si algo falla (por ejemplo tablas ya existentes), conviene proyecto limpio o revisar el mensaje de error.

3. **Authentication** → **Providers** → habilitá **Email** (confirmación por mail podés desactivarla en *Auth settings* → *Disable email confirmations* para pruebas).

## 2. Visualizar (sin código)

- **Table Editor**: tablas `matches`, `match_members`, `characters`, `checks`, etc., después de correr el script o de insertar a mano.
- **Database** → **Publications**: verificá que `supabase_realtime` incluya las tablas (la migración lo intenta).
- **API Docs** (o *Project API*): referencia de REST; las RPC aparecen como funciones expuestas vía PostgREST cuando tengan `GRANT` adecuado (ya está en la migración).

**Importante:** en el **SQL Editor** sos el rol de administrador: `auth.uid()` es **null**. Las RPC que usan `auth.uid()` **no** se pueden probar ahí como si fueras un usuario; para eso usá el script o una app con login.

## 3. Probar el flujo con script (recomendado)

1. En la raíz `online/`, copiá `.env.example` a `.env.local` y completá URL, anon key y mails/contraseñas de prueba. Los mails deben pasar la validación de Supabase (evitá dominios tipo `@something.test.local`; con confirmación de mail desactivada podés usar pares `@example.com` como en el ejemplo).

2. Instalá dependencias (necesitás Node + npm en el PATH):

```bash
cd online
npm install
```

3. Ejecutá el smoke test (crea partida, join, PJ mínimo, check, respuesta RPC):

```bash
npm run smoke
```

El script:

- Intenta **sign in**; si falla, hace **sign up** y vuelve a entrar (master y jugador).
- Master: `create_match` → lee el **código** de la tabla `matches`.
- Jugador: `join_match_with_code`.
- Jugador: crea personaje + 6 stats + recursos (vía RLS).
- Master: asigna `match_characters`, `character_runtime`, `checks`, `check_targets`.
- Jugador: `submit_check_response`.
- Imprime un resumen; podés contrastar en **Table Editor**.

Si el signup requiere confirmación de email, desactivá la confirmación en Auth o confirmá los usuarios desde el dashboard.

Si ves **email rate limit exceeded**, dejá pasar un rato o creá **Authentication → Users** los dos mails del `.env.local` con su contraseña y volvé a ejecutar el smoke (solo hará login).

## 4. Probar desde una app (siguiente paso)

### Master web (Next.js, en el repo)

1. Creá `apps/master-web/.env.local` con `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` (mismos valores que en `online/.env.local`, cambiando solo el prefijo de las variables).
2. Desde la carpeta `online/`: `npm install` (si no lo hiciste) y luego `npm run dev:master-web`.
3. Abrí [http://localhost:3000](http://localhost:3000): entrá con el usuario **master** y usá **Crear partida**; se muestra el **código** de la partida.

### App jugador (Expo, en el repo)

1. `apps/mobile/.env.local` con `EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_ANON_KEY` (mismos valores que en master-web, solo cambia el prefijo de las variables).
2. Desde `online/`: `npm install` y luego `npm run dev:mobile` (compila `@dxd/shared` y abre Expo con el proyecto en `apps/mobile/`, donde debe estar `.env.local`).
3. **Expo Go** en el celular: escaneá el QR. Entrá con el usuario **jugador** y el **código** de la partida.
4. En la app: **Crear personaje** y pasá al master el **UUID del personaje** (y tu `user id` si lo pide).
5. En la web master: **Asignar personaje + runtime**, luego **Lanzar check de prueba** (Brains, DC 10).
6. En la app: **Buscar check** y **Enviar respuesta** con tirada / fichas / modificador.

### Más adelante (más pantallas)

- UI más rica, realtime, y más RPC si hace falta (`packages/shared/src/rpc/client.ts`).

## 5. Supabase CLI (opcional)

Si más adelante usás `supabase link` + `supabase db push`, las migraciones van versionadas al proyecto remoto; para empezar rápido alcanza con copiar/pegar en SQL Editor.
