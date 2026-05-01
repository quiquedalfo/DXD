# DXD Online (cliente–servidor)

Monorepo propuesto para la especificación **Supabase + Expo + Next.js**. El desktop Python en la raíz del repo (`../`) queda como referencia histórica; la **fuente de verdad** pasa a ser Postgres.

## Estructura

```
online/
  apps/
    mobile/          # Expo — jugador: login + unirse por código (`npm run dev:mobile` desde online/)
    master-web/      # Next.js — login master + crear partida (`npm run dev:master-web` desde online/)
  packages/
    shared/          # Tipos, dominio, helpers Supabase, utils
  supabase/
    migrations/      # SQL inicial + RLS + Realtime + RPC (create/join/submit)
  docs/
    WIREFRAMES.md
    FLUJO_MVP.md
```

## Comandos base

```bash
cd online
npm install
npm run typecheck -w @dxd/shared
```

Variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (web) y `EXPO_PUBLIC_*` (mobile). Para **master-web**, creá `apps/master-web/.env.local` (podés copiar desde `apps/master-web/.env.example`) con los mismos valores que `online/.env.local` pero con prefijo `NEXT_PUBLIC_`. Después de editar `.env.local`, **reiniciá** `next dev` (Ctrl+C y volver a `npm run dev:master-web`).

## Arranque rapido (2 terminales)

Usa dos terminales en paralelo para ver ambas pantallas (master web + mobile):

**Terminal 1 (en `online/`) - master web**

```bash
cd online
npm run dev:master-web
```

**Terminal 2 (en `online/`) - mobile**

```bash
cd online
npm run dev:mobile
```

Alternativa equivalente para mobile (si ya estas parado en `apps/mobile`):

```bash
cd online/apps/mobile
npm run start
```

Abrí [http://localhost:3000](http://localhost:3000), entrá con el mail del master y usá **Crear partida**; se muestra el **código** para compartir.

En mobile, escaneá el QR con **Expo Go**.

## Modo tunnel (otra red o LAN que no conecta)

Si el **teléfono no está en la misma Wi‑Fi** que la PC, o Expo Go no llega al bundler por LAN (`Connection refused`, timeout al escanear el QR), usá el **tunnel** de Expo: el CLI publica el dev server a través de un túnel (p. ej. ngrok) y el QR apunta a una URL alcanzable desde internet.

Desde `online/` (después de `npm install` y con el shared ya compilado si hace falta):

```bash
cd online/apps/mobile
npx expo start --tunnel
```

Equivalente con caché limpia si Metro da problemas:

```bash
cd online/apps/mobile
npx expo start -c --tunnel
```

**Notas:** la primera vez puede pedirte iniciar sesión con cuenta **Expo** (el tunnel depende del servicio de Expo). Es más lento que LAN y puede fallar si hay cortafuegos muy estrictos; para desarrollo diario en la misma red, seguí con `npm run dev:mobile` sin `--tunnel`.

## Notas de entorno

En `apps/mobile/.env.local` usá `EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_ANON_KEY` (mismos valores que en master-web).

Escaneá el QR con **Expo Go** (Android/iOS); la versión del proyecto (**SDK 54**) tiene que coincidir con la de Expo Go (si actualizás Expo Go, mantené el `expo` del `package.json` alineado, p. ej. con `npx expo install expo@^54 --fix` desde `apps/mobile`).

Si en iOS/Android ves **`PlatformConstants` / TurboModule** o `[runtime not ready]`, Metro suele estar mezclando dependencias o caché: desde `apps/mobile` ejecutá `npx expo start -c` (caché limpia). El `metro.config.js` ya no vigila toda `online/` (evita cruzar el `src/app` de Next con el bundler de Expo).

**Probar sin app:** guía en [docs/PROBAR.md](docs/PROBAR.md) y `npm run smoke` con `.env.local`.
