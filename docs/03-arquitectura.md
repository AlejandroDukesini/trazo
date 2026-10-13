# 03 · Arquitectura y decisiones técnicas

## Visión general

```
trazo/
├─ packages/core        Dominio puro TypeScript (sin DOM ni Node): esquemas, geo, filtros GPS,
│                       métricas, máquina de estados de grabación, GPX/TCX, segmentos,
│                       entrenamiento, privacidad, matriz de planes. Lo usan web y API.
├─ apps/api             Backend Fastify + PostgreSQL (Kysely). Auth, autorización, sincronización,
│                       social, segmentos, suscripciones, proxies de geocodificación/rutas.
└─ apps/web             React + Vite. UI única para web, PWA, Android (Capacitor) y Windows (Tauri).
   ├─ android/          Proyecto nativo Capacitor + plugin Kotlin `TrazoTracker` (GPS en segundo plano).
   └─ src-tauri/        Envoltorio de escritorio Tauri 2.
```

Una sola base de UI y lógica. Lo nativo se limita a **adaptadores** (`apps/web/src/platform/*`):
geolocalización (web `watchPosition` vs. plugin nativo), almacenamiento del token, archivos.

## Stack elegido y motivos

| Capa | Elección | Motivo |
|---|---|---|
| UI | React 19 + TypeScript + Vite | Ecosistema maduro, compatible con Capacitor y Tauri sin cambios. |
| Router | React Router | Estándar, rutas anidadas para shells móvil/escritorio. |
| Estilos | CSS con tokens (custom properties) + CSS Modules | Cero runtime, temas claro/oscuro con un atributo, control total de la identidad. |
| Iconos | lucide-react (ISC) | Coherentes, tree-shakeable, sin marca ajena. |
| Mapas | MapLibre GL JS + OpenFreeMap | Vectorial, rendimiento, gratis y sin clave. |
| Gráficos | uPlot | ~45 KB, renderiza 100 k puntos con fluidez (canvas). |
| Datos locales | Dexie (IndexedDB) | Transacciones, índices, consultas; funciona en web, Capacitor y Tauri (WebView). SQLite nativo solo dentro del plugin GPS de Android, donde sobrevive a la muerte del WebView. |
| Backend | Node 24 + Fastify 5 + Kysely + PostgreSQL | Tipado de extremo a extremo, rendimiento, migraciones en TS, sin ORM pesado. |
| Validación | Zod (compartida en `core`) | Mismo esquema en cliente y servidor. |
| Auth | Contraseña argon2id + token de sesión opaco (hash SHA-256 en BD) | Revocable, sin JWT de larga vida. Web: cookie `HttpOnly; SameSite=Lax` + comprobación de `Origin`. Android/Windows: `Authorization: Bearer`. |
| Android | Capacitor 8 + plugin Kotlin propio | Reutiliza la web; servicio en primer plano real. |
| Windows | Tauri 2 (+ PWA) | Instalador MSI/NSIS ligero (WebView2). |
| Tests | Vitest (core, api con Postgres real), Playwright (e2e web) | |

## Sincronización local-first

**Identificadores estables**: toda actividad/ruta se crea en el cliente con UUID v7. Es la clave de idempotencia.

Tablas locales (Dexie): `activities`, `streams`, `outbox`, `recording` (sesión activa), `recPoints`, `meta`.

Estado por entidad: `local` (solo en el dispositivo, sin cuenta), `pending` (en cola), `synced`, `conflict`.

**Outbox persistente**: cada cambio se escribe en la misma transacción IndexedDB que el dato y una operación
`{ op: create|update|delete, entityId, baseVersion }`. El motor de sincronización:

1. Se ejecuta al arrancar, al recuperar conexión (`online`), tras cada cambio y con reintentos exponenciales (máx. 5 min).
2. Bloqueo entre pestañas con Web Locks API para que solo una pestaña sincronice.
3. Procesa en orden por entidad; varias actualizaciones pendientes se fusionan.

**Protocolo servidor**:

- `PUT /activities/:id` (crear): si ya existe y es del mismo usuario → devuelve la existente (reintento tras respuesta perdida = sin duplicado). Si es de otro usuario → 409.
- `PATCH /activities/:id` con `baseVersion`: si `baseVersion ≠ version` → **409 con la copia del servidor**. El cliente marca `conflict` y el usuario elige *conservar la mía* (reenvía con la versión nueva) o *usar la del servidor*. Nunca se sobrescribe en silencio.
- `DELETE` es idempotente (borrado lógico con *tombstone*).
- `GET /sync/activities?since=<seq>`: cambios propios ordenados por `change_seq` (secuencia global) incluyendo borrados. Otros dispositivos de la misma cuenta convergen.

Los datos sociales (feed, comentarios, clubes…) **no** son offline: se cachean para lectura (stale-while-revalidate) y requieren conexión para escribir.

## Grabación GPS

Máquina de estados pura en `core/recording.ts`:

```
ready ──START──▶ recording ──PAUSE──▶ paused ──RESUME──▶ recording
                    │                    │
                    └──────FINISH────────┴──▶ finishing ──SAVED──▶ saved
                                                  └──FAILED──▶ error (recuperable: reintentar / descartar)
```

- Cada punto aceptado se escribe en IndexedDB en lotes cada ≤ 2 s (o inmediatamente en Android, donde el servicio
  nativo ya lo ha persistido en SQLite antes de entregarlo).
- Índice de tramo (`seg`) por punto: la distancia nunca cruza una pausa.
- Tres relojes: `elapsed` (pared, inicio→fin), `timer` (sin pausas manuales), `moving` (solo en movimiento).
- Recuperación: al abrir la app, si existe una sesión `recording/paused` se ofrece *continuar* o *guardar*.
- `FINISH` es idempotente (la sesión se marca `finishing` antes de construir la actividad; un segundo toque no hace nada).

Filtro GPS (`core/gps-filter.ts`): descarta precisión > 35 m, marcas de tiempo repetidas o retrocedidas,
puntos casi idénticos, y saltos con velocidad implícita imposible para el deporte (con tolerancia por precisión).
Desnivel: suavizado con umbral de histéresis de 3 m para no acumular ruido barométrico/GPS.

## Seguridad y privacidad

- Autorización **en cada handler** del backend (`assertCanView/Edit`), nunca en la UI.
- Visibilidad por actividad: `public`, `followers`, `private`. Cuentas privadas: seguir requiere aprobación.
- **Zonas privadas**: los puntos dentro de las zonas del propietario se eliminan en el servidor antes de enviar
  recorridos a cualquier otra persona (incluida la polilínea del feed y los puntos de inicio/fin).
- Bloqueo: oculta contenido en ambos sentidos e impide seguir, comentar y reaccionar.
- Rate limit global y específico en login/registro.
- Importación: límite de tamaño (15 MB), parser XML sin entidades externas, validación de rangos.
- Secretos solo por variables de entorno (`.env` ignorado). Logs con redacción de cabeceras de autorización/cookies.

## Suscripciones

- `core/plans.ts`: matriz central `feature → planes`. Precios/periodos **no** están en código: se leen de los IDs de
  precio del proveedor (`STRIPE_PRICE_*`).
- El backend calcula *entitlements* desde la tabla `subscriptions` (estado + fin de periodo). El cliente solo los muestra.
- Webhooks Stripe con firma verificada y tabla `billing_events` (clave única por evento → idempotente).
- Google Play Billing: diseñado (verificación con Google Play Developer API), pendiente de cuenta de Play Console.
- Sin claves configuradas, los endpoints de pago responden `503 billing_unavailable`. No hay pagos simulados.

## Fórmulas (documentadas también en el código)

| Métrica | Fórmula |
|---|---|
| Distancia | Haversine entre puntos consecutivos del mismo tramo, R = 6 371 008.8 m |
| Ritmo | tiempo en movimiento / distancia |
| Desnivel positivo | suma de subidas tras histéresis de 3 m |
| Calorías (estimación) | MET(deporte, velocidad) × peso(kg) × horas en movimiento. Solo si el usuario indica su peso; siempre marcada "estimada". |
| Carga con FC | TRIMP de Edwards: Σ minutos en zona_i × i (zonas 50-60-70-80-90 % FCmáx) |
| Carga sin FC | sRPE de Foster: minutos × esfuerzo percibido (1–10) indicado por el usuario |
| Forma / fatiga | CTL = media exponencial 42 d de la carga; ATL = 7 d; TSB = CTL − ATL. Indicadores orientativos, no diagnóstico. |
| Predicción de carrera | Riegel: T₂ = T₁ · (D₂/D₁)^1.06, marcada como estimación |
