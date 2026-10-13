# 06 · Modo local (sin cuenta ni servidor)

Trazo se convirtió, a propósito, en una **app local de un solo usuario**. Este documento describe la
arquitectura resultante y qué cambió respecto al diseño original (`docs/01`–`04`, que describen la
plataforma social con backend).

## Principios

- **Todo en el dispositivo.** No hay backend, cuenta ni inicio de sesión. Los datos no salen del
  navegador/app. No se recopila información personal.
- **La lógica vive en `packages/core`.** Métricas, filtros GPS, grabación, GPX/TCX, segmentos,
  entrenamiento y objetivos son TypeScript puro que antes usaba el servidor y ahora corre en el
  cliente, sin cambios en el dominio.
- **Gratis y completo.** Se eliminaron las funciones de pago y sus bloqueos.

## Qué se eliminó

- `apps/api` (backend Fastify + PostgreSQL) y la capa de sincronización (`data/sync.ts`, outbox,
  resolución de conflictos).
- Autenticación y pantallas de registro/login/recuperación (`features/auth`).
- Comunidad: `features/social/*` (clubes, personas, retos, feed, comentarios, reacciones,
  notificaciones) y la moderación.
- Suscripciones y UI premium (`PlusPage`, `PlusLock`, candados y chips "Plus").

## Qué se añadió

- **Importación por pantallazo** (`features/activities/screenshot.ts` + modo en `ImportPage`):
  OCR con **tesseract.js** en el propio dispositivo. El parser extrae distancia, tiempo, desnivel y
  FC media de forma heurística; la UI **siempre** deja revisar y corregir, y **no inventa** datos
  que no encuentra. La imagen se adjunta a la actividad como foto local.

## Capa de datos

- **IndexedDB** con Dexie (`data/db.ts`), base por usuario con id fijo `local`:
  - `activities`, `streams` (recorridos), `recSessions`/`recPoints` (grabación en curso),
    `goals`, `routes`, `segments`, `kv` (plan de entrenamiento activo, etc.).
- **Perfil** (`data/session.tsx` + `getProfile/setProfile`): un único perfil local
  (nombre, foto como data URL, unidades, peso, FC máx./reposo, FTP) en el almacén global.
- Módulos locales que sustituyen a los endpoints del backend:
  - `data/goals.ts` — objetivos y su progreso (con `@trazo/core`).
  - `data/routes-local.ts` — CRUD de rutas.
  - `data/segments-local.ts` — crear segmentos y detectar intentos (`matchSegment`).
  - `data/training-local.ts` — plan de entrenamiento activo.
  - `data/geo-local.ts` — búsqueda de lugares vía **Photon** (directo, sin clave).

## Servicios externos (directos desde el cliente)

- **OpenFreeMap** — teselas del mapa (MapLibre), sin clave.
- **Photon (Komoot)** — geocodificación para el editor de rutas, sin clave.
- **tesseract.js** — descarga el motor OCR la primera vez (se cachea); después funciona offline.

No se usa la API de Strava ni ningún backend propio. El cálculo de rutas por caminos (que requería un
servicio con clave) se retiró; el editor traza líneas rectas entre puntos e importa trazas GPX reales.

## Multiplataforma

La misma app se empaqueta con Capacitor (Android) y Tauri (Windows). Como ya no hay backend, no se
necesita configurar ninguna URL de API: el empaquetado solo envuelve la web local. Ver
[`05-plataformas.md`](05-plataformas.md).
