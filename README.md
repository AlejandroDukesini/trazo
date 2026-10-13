# Trazo

Plataforma deportiva propia (registro de actividades con GPS, mapas, rutas, estadísticas,
comunidad, segmentos, análisis de entrenamiento y suscripciones) con una única base de código
para **web responsive**, **PWA instalable**, **Android** (Capacitor) y **Windows** (Tauri).

Producto original inspirado solo en las *capacidades funcionales* de aplicaciones deportivas de
referencia. No usa la marca, los textos, los iconos, los colores ni la API de Strava. Toda la
funcionalidad es propia y la importación de actividades se hace con archivos **GPX/TCX** que aporta
la persona usuaria. Ver [`docs/01-investigacion.md`](docs/01-investigacion.md) para los límites legales.

El estado real de implementación (qué está verificado y qué depende de dispositivo) vive en
[`ESTADO.md`](ESTADO.md). El diseño y las decisiones técnicas, en [`docs/`](docs/).

## Monorepo

```
trazo/  (pnpm workspaces)
├─ packages/core     Dominio puro TypeScript (sin DOM ni Node): esquemas, geo, filtros GPS,
│                    métricas, máquina de estados de grabación, GPX/TCX, segmentos, entrenamiento,
│                    privacidad, matriz de planes. Compartido por web y API.
├─ apps/api          Backend Fastify + PostgreSQL (Kysely): auth, autorización, sincronización,
│                    social, segmentos, suscripciones, proxies de geocodificación/rutas.
└─ apps/web          React + Vite. UI única para web, PWA, Android y Windows.
   ├─ android/       Proyecto Capacitor + plugin Kotlin/Java TrazoTracker (GPS en segundo plano).
   └─ src-tauri/     Envoltorio de escritorio Tauri 2.
```

Lo nativo se limita a **adaptadores** en `apps/web/src/platform/*` (geolocalización, almacenamiento
del token, archivos). La lógica de negocio no se duplica entre plataformas: vive en `packages/core`.

## Stack

- **Core/UI:** TypeScript 5.9, React 19, Vite 8, React Router 8, TanStack Query 5.
- **Datos locales:** IndexedDB con Dexie 4 (cola de sincronización, actividades offline).
- **Mapas:** MapLibre GL 6 con teselas de [OpenFreeMap](https://openfreemap.org) (sin clave).
- **Gráficos:** µPlot. **Iconos:** lucide-react. **Tipografía:** Inter.
- **Backend:** Fastify 5, PostgreSQL 16+ (Kysely), Argon2 para contraseñas, Zod para validación,
  Pino para logs, Nodemailer para correo, Stripe para pagos web.
- **Empaquetado:** Capacitor 8 (Android), Tauri 2 (Windows: instaladores NSIS y MSI).

## Requisitos

- **Node ≥ 22** y **pnpm** (`corepack enable`).
- **PostgreSQL ≥ 16** (con la extensión `citext`) para ejecutar la API y sus pruebas.
- Solo para compilar nativo: **Android SDK + JDK 17** (Android) y **Rust estable + herramientas de
  compilación de Windows** (Tauri). Ver [`docs/05-plataformas.md`](docs/05-plataformas.md).

## Puesta en marcha (web + API)

```bash
pnpm install

# API
cp apps/api/.env.example apps/api/.env   # y edita DATABASE_URL, etc.
createdb trazo_dev                        # o usa tu PostgreSQL existente
pnpm --filter @trazo/api migrate          # aplica migraciones
pnpm --filter @trazo/api dev              # API en http://127.0.0.1:3000

# Web (en otra terminal)
pnpm --filter @trazo/web dev              # http://localhost:5173
```

En desarrollo, la web habla con la API mediante el proxy de Vite (`/api` → `API_PROXY`, por defecto
`http://127.0.0.1:3000`), así que no necesitas configurar la URL del backend. En los **builds nativos**
(Android/Windows) la base es una URL absoluta obligatoria: define `VITE_API_URL` al compilar.

## Scripts

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Arranca web y API en paralelo. |
| `pnpm build` | Compila todos los paquetes. |
| `pnpm typecheck` | `tsc --noEmit` en todo el workspace. |
| `pnpm test` | Pruebas de los tres paquetes (requiere `TEST_DATABASE_URL` para la API). |
| `pnpm db:migrate` | Aplica migraciones de la base de datos. |
| `pnpm --filter @trazo/web e2e` | Pruebas end-to-end con Playwright. |

## Pruebas

- **Automatizadas (sin dispositivo):** `pnpm test` → core (30), API (26, necesita PostgreSQL de
  pruebas), web (10). E2E con Playwright en `apps/web/e2e`.
- **Dispositivo (no automatizables aquí):** scripts en `apps/web/device-tests/` que verifican la
  grabación con la pantalla apagada, la recuperación tras matar el proceso y la inspección en vivo
  del WebView por ADB. Ver [`docs/05-plataformas.md`](docs/05-plataformas.md).

El estado de la matriz de aceptación del prompt (20 puntos) está en [`ESTADO.md`](ESTADO.md).

## Compilación por plataforma

Los pasos detallados (requisitos, firmas, instaladores y pruebas de dispositivo) están en
[`docs/05-plataformas.md`](docs/05-plataformas.md). Resumen:

- **Web / PWA:** `pnpm --filter @trazo/web build` → `dist/` (incluye manifiesto y service worker).
- **Android:** `pnpm --filter @trazo/web build && pnpm --filter @trazo/web android:sync`, luego
  `cd apps/web/android && ./gradlew assembleDebug`.
- **Windows:** `pnpm --filter @trazo/web tauri build` → instaladores NSIS y MSI.

## Servicios externos y costes

| Servicio | Uso | Coste / límite |
|---|---|---|
| OpenFreeMap | Teselas del mapa | Gratuito, sin clave (uso justo). |
| openrouteservice | Cálculo de rutas | Plan gratuito ~2000 req/día, requiere `ORS_API_KEY`. |
| Photon (Komoot) | Geocodificación | Público gratuito; configurable con `PHOTON_URL`. |
| Stripe | Pagos web | Comisión por transacción; claves de test en desarrollo. |
| Google Play Billing | Pagos Android | Comisión de la tienda; pendiente de cuenta Play Console. |

Sin claves de pago configuradas, los endpoints de facturación responden `503 billing_unavailable`:
**no hay pagos simulados**. Todos los secretos se leen de variables de entorno; `.env` está ignorado
por git. Variables documentadas en [`apps/api/.env.example`](apps/api/.env.example).

## Modelo de datos

PostgreSQL, 25 tablas (migración `apps/api/src/db/migrations/0001_init.ts`): `users`, `sessions`,
`password_resets`, `privacy_zones`, `activities`, `activity_streams`, `activity_photos`, `follows`,
`blocks`, `reactions`, `comments`, `notifications`, `reports`, `clubs`, `club_members`, `challenges`,
`challenge_participants`, `segments`, `segment_efforts`, `goals`, `routes`, `plan_enrollments`,
`billing_customers`, `subscriptions`, `billing_events`.

## Licencia y marcas

Producto propio. No incluye recursos, marcas ni API de terceros protegidos. No hagas commits,
despliegues ni compras de servicios sin autorización.
