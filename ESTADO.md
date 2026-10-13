# Estado de implementación

Última verificación: **2026-10-12**. Comprobado en esta máquina:

- `pnpm typecheck` → verde en `packages/core`, `apps/api`, `apps/web`.
- `pnpm test` → **66 pruebas** pasan: core 30, API 26 (PostgreSQL de pruebas), web 10.
- `pnpm --filter @trazo/api build` → `dist/` generado.
- `pnpm --filter @trazo/web build` → `dist/` con PWA (service worker + 88 entradas de precache).

Leyenda: ✅ implementado y verificado automáticamente · 📱 implementado, verificable solo en
dispositivo/entorno real · 🔑 implementado, requiere credenciales/cuenta externa para activarse.

## Fases del plan

| Fase | Estado | Notas |
|---|---|---|
| 1 · Auditoría y diseño | ✅ | `docs/01`–`03`, matriz funcional, arquitectura, modelo de datos. |
| 2 · Base funcional | ✅ | Sistema de diseño, temas claro/oscuro, navegación, auth, persistencia local, backend+sync, PWA. |
| 3 · Núcleo deportivo | ✅ | Grabación (máquina de estados), historial, detalle, mapas/rutas, import/export GPX-TCX, estadísticas. |
| 4 · Comunidad | ✅ | Perfiles, feed, seguidores, comentarios/reacciones, clubes, retos, notificaciones, moderación. |
| 5 · Funciones avanzadas | ✅ / 🔑 | Segmentos, análisis de entrenamiento, objetivos, planes. Premium validado en backend; pagos requieren claves. |
| 6 · Apps instalables | ✅ / 📱 | PWA ✅. Android (Capacitor + plugin TrazoTracker) y Windows (Tauri) implementados; builds nativos requieren SDK/toolchain. |
| 7 · Validación | ✅ / 📱 | Pruebas automatizadas y E2E ✅. GPS en segundo plano y recuperación de proceso: scripts de dispositivo. |

## Matriz de aceptación (§11 del encargo)

| # | Criterio | Estado |
|---|---|---|
| 1 | Registro, autenticación y recuperación de sesión | ✅ |
| 2 | CRUD y consulta de actividades | ✅ |
| 3 | Grabación GPS y persistencia de puntos | ✅ (web) · 📱 (Android segundo plano) |
| 4 | Pausa, reanudación y finalización | ✅ |
| 5 | Recuperación tras interrupciones | ✅ (web/sesión) · 📱 (muerte de proceso: `device-tests/android-kill.mjs`) |
| 6 | Cálculo de distancia, ritmo y duración | ✅ (`core/metrics`, tests) |
| 7 | Importación y exportación de recorridos | ✅ (GPX/TCX, tests) |
| 8 | Operación offline y sincronización posterior | ✅ (cola Dexie, idempotencia) |
| 9 | Prevención de actividades duplicadas | ✅ (IDs estables + idempotencia) |
| 10 | Privacidad y permisos de acceso | ✅ (autorización por handler, zonas privadas, tests) |
| 11 | Feed, comentarios, reacciones y retos | ✅ |
| 12 | Segmentos y tablas de clasificación | ✅ |
| 13 | Validación de suscripciones y derechos premium | ✅ (entitlements en backend) · 🔑 (pagos reales) |
| 14 | Cambio entre temas claro y oscuro | ✅ |
| 15 | Diseño responsive móvil/escritorio | ✅ |
| 16 | Instalación PWA y service worker | ✅ (build genera `sw.js` + manifiesto) |
| 17 | Compilación Android | 📱 (requiere Android SDK + JDK 17) |
| 18 | Compilación y empaquetado Windows | 📱 (requiere Rust + toolchain Windows) |
| 19 | Accesibilidad básica | ✅ (E2E con `@axe-core/playwright`) |
| 20 | Rendimiento con historiales y recorridos extensos | ✅ (paginación, procesado incremental, carga diferida) |

## Pendiente / limitaciones conocidas

- **Builds nativos** (Android/Windows) no se han ejecutado en este entorno por falta de SDK/toolchain;
  el código y la configuración están listos (ver `docs/05-plataformas.md`).
- **Pagos:** Stripe operativo con claves de test; Google Play Billing diseñado pero pendiente de
  cuenta de Play Console. Sin claves → `503 billing_unavailable`, nunca pagos ficticios.
- **Pruebas de dispositivo** (GPS con pantalla apagada, recuperación de proceso) requieren un
  emulador/dispositivo Android con ADB; se proporcionan scripts reproducibles, no automatizados en CI.
- **Mapas offline** dependen de licencia/soporte del proveedor; no se descargan teselas de servicios
  que lo prohíban.

## Próximo paso recomendado

Ejecutar los builds nativos en una máquina con Android SDK y toolchain de Windows, generar los
instaladores y correr los `device-tests` para marcar los puntos 3/5/17/18 como verificados en
hardware real.
