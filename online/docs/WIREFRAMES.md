# Wireframes simples (MVP)

Texto orientativo para Expo (jugador) y Next (master). Las cajas son bloques, no píxeles finales.

## Jugador — runtime (idle)

```
┌──────────────────────────────────────┐
│  [avatar]  NOMBRE PERSONAJE          │
│  sync: online                        │
├──────────────────────────────────────┤
│  ESCENA (1–2 líneas)                 │
│  “…”                                 │
├──────────────────────────────────────┤
│  Fichas: 3      Mod actual: +0       │
├──────────────────────────────────────┤
│  Stat      Dado   Mod base           │
│  Análisis  D10    +0                 │
│  Potencia  D8     +0                 │
│  … (6 filas)                         │
├──────────────────────────────────────┤
│  Último: —                           │
│                                      │
│   ░░░  ESPERANDO AL MASTER  ░░░      │
└──────────────────────────────────────┘
```

## Jugador — runtime (check activo)

```
┌──────────────────────────────────────┐
│  ⚡ CHECK ⚡   (animación / vibración)│
├──────────────────────────────────────┤
│  Pedido: Análisis (Brains)           │
│  Objetivo del check: 12              │
│  Instrucción del master:             │
│  “…”                                 │
├──────────────────────────────────────┤
│  Valor tirado (dado real): [____]    │
│  Fichas a gastar:      [—]  (si ON)  │
│  Modificador manual:   [—]  (si ON)  │
│                                      │
│         [ ENVIAR RESULTADO ]         │
└──────────────────────────────────────┘
```

## Jugador — home

```
┌──────────────────────────────────────┐
│  Hola, {display}                     │
│  [ Crear personaje ]                 │
│  [ Unirse con código ______ ]        │
├──────────────────────────────────────┤
│  Mis personajes                      │
│  - Pepe                              │
│  - Lula                              │
├──────────────────────────────────────┤
│  Partidas                            │
│  - Mesa viernes (LIVE)               │
└──────────────────────────────────────┘
```

## Master — mesa (consola)

```
┌─────────────────────────────────────────────────────────────┐
│  TÍTULO PARTIDA          Código: ABC12    [LIVE ▼]          │
│  Escena: [ textarea editable........................... ]   │
│                                    [ Guardar escena ]        │
├───────────────────────────────┬─────────────────────────────┤
│  JUGADORES                    │  FEED EN VIVO               │
│  Ana   🟢  Pj: Lula           │  • Joaking respondió…       │
│        tok 3  mod +0          │  • Master abrió check…      │
│        [ +check ] [tok±][mod±]│  • …                        │
│  Tito  ⚪  Pj: —               │                             │
│        [ asignar personaje ]  │                             │
│  …                            │                             │
├───────────────────────────────┴─────────────────────────────┤
│  CHECKS ABIERTOS / ACCIONES RÁPIDAS                         │
│  [ Check a uno ] [ Check a varios ] [ Check a todos ]       │
└─────────────────────────────────────────────────────────────┘
```

## Master — modal “nuevo check”

```
┌─────────────────────────────┐
│  Nuevo check                │
│  Stat: [ Análisis ▼ ]       │
│  Valor check: [ 12 ]        │
│  Instrucción: [........]    │
│  ☑ permitir fichas          │
│  ☑ permitir mod manual      │
│  Destino: ( ) uno ( ) varios│
│           (•) todos         │
│  [ Cancelar ]  [ Lanzar ]   │
└─────────────────────────────┘
```
