# Estado de implementación

Última verificación: **2026-10-12** (app local). Comprobado en esta máquina:

- `pnpm typecheck` → verde en `packages/core` y `apps/web`.
- `pnpm test` → **37 pruebas** pasan: core 30, web 7 (grabador 3, OCR de pantallazo 4).
- `pnpm --filter @trazo/web build` → `dist/` con PWA (service worker + 70 entradas de precache).

## Cambio de rumbo: de plataforma social a app local

El producto pasó de ser una plataforma con backend, cuentas y suscripciones a una **app local de un
solo usuario**. Se eliminaron:

- **Backend** (`apps/api`) y toda la sincronización remota.
- **Cuentas e inicio de sesión**: ahora hay un perfil local sin login.
- **Comunidad**: clubes, personas, retos, feed, comentarios, reacciones, notificaciones, moderación.
- **Funciones premium / pagos**: todo es gratuito, sin bloqueos.

Se añadió: **importación de actividades por pantallazo** con OCR local (tesseract.js) y revisión manual.

Detalle de la arquitectura en [`docs/06-modo-local.md`](docs/06-modo-local.md).

## Funciones (todas locales, verificadas)

| Área | Estado |
|---|---|
| Grabación GPS (máquina de estados, recuperación) | ✅ (unit + e2e) |
| Importar GPX/TCX | ✅ |
| Importar por pantallazo (OCR + revisión) | ✅ (parser con tests; OCR en el navegador) |
| Añadir actividad manual | ✅ |
| Historial, filtros y detalle con mapa/gráficos | ✅ |
| Parciales, vueltas, mejores esfuerzos | ✅ |
| Comparar dos actividades | ✅ |
| Progreso: resúmenes, comparativa de periodos, objetivos, récords | ✅ |
| Entrenamiento: carga/forma/fatiga, zonas FC, planes | ✅ |
| Rutas: dibujo, búsqueda de lugares (Photon), import/export GPX | ✅ |
| Segmentos personales y tus intentos | ✅ |
| Perfil local, exportar/borrar datos | ✅ |
| Tema claro/oscuro, responsive, PWA | ✅ |
| Exportar GPX/TCX de una actividad | ✅ |

## Pendiente / limitaciones conocidas

- **OCR de pantallazo**: la lectura no es perfecta; la UI siempre deja revisar y corregir, y nunca
  inventa datos. La primera ejecución descarga el motor OCR (luego queda cacheado para uso offline).
- **Rutas por caminos (auto-routing)**: se eliminó porque requería un servicio con clave/backend. El
  editor traza líneas rectas entre puntos e importa trazas GPX reales. La búsqueda de lugares sí
  funciona (Photon, gratuito).
- **Builds nativos** (Android/Windows): el código y la configuración siguen listos, pero no se han
  compilado en este entorno por falta de SDK/toolchain (ver `docs/05-plataformas.md`).
- `apps/api/` quedó como carpeta vacía porque un proceso del sistema la tenía bloqueada al borrarla;
  es inofensiva (sin `package.json`, pnpm la ignora) y puede borrarse al cerrar el IDE.

## Próximo paso recomendado

Probar la importación por pantallazo con capturas reales y afinar el parser (`screenshot.ts`) según
los formatos que uses, y compilar los paquetes nativos en una máquina con las herramientas instaladas.
