# Trazo

App deportiva **totalmente local** y de un solo usuario: registra actividades con GPS, las analiza
(mapas, gráficos, segmentos, entrenamiento) y las guarda **solo en tu dispositivo**. Sin cuenta, sin
inicio de sesión y sin servidor. Funciona como **web responsive**, **PWA instalable**, app **Android**
(Capacitor) y app **Windows** (Tauri), compartiendo una única base de código.

Producto original inspirado solo en las *capacidades funcionales* de apps deportivas de referencia.
No usa la marca, los textos, los iconos ni la API de Strava.

> **Nota de evolución.** El proyecto empezó como una plataforma social con backend, cuentas y
> suscripciones (ver `docs/01`–`04`). Después se convirtió, a propósito, en una app **local, personal
> y gratuita**: se eliminaron el backend, las cuentas, la comunidad (clubes, personas, retos, feed) y
> las funciones de pago, y se añadió la importación de actividades **por pantallazo** (OCR local). La
> arquitectura actual está en [`docs/06-modo-local.md`](docs/06-modo-local.md); el estado real en
> [`ESTADO.md`](ESTADO.md).

## Qué incluye

- **Grabar** actividades con GPS (máquina de estados fiable, recuperación tras cierre).
- **Importar** desde archivo **GPX/TCX**, **por pantallazo** (OCR en el dispositivo) o a mano.
- **Historial**, detalle con mapa y gráficos, parciales, vueltas y mejores esfuerzos.
- **Progreso**: resúmenes por periodo, comparativa entre periodos, objetivos y récords personales.
- **Entrenamiento**: carga/forma/fatiga (CTL/ATL/TSB), zonas de FC y planes.
- **Rutas**: dibujo en el mapa, búsqueda de lugares, importación/exportación GPX.
- **Segmentos personales**: crea un tramo y detecta automáticamente tus intentos.
- **Ajustes**: perfil local (nombre, foto, unidades, peso, FC, FTP), exportar/borrar tus datos.
- Tema claro/oscuro, diseño responsive, PWA instalable y offline.

Todo es gratuito: no hay funciones de pago ni bloqueos.

## Monorepo

```
trazo/  (pnpm workspaces)
├─ packages/core     Dominio puro TypeScript: métricas, geo, filtros GPS, máquina de grabación,
│                    GPX/TCX, segmentos, entrenamiento, objetivos. Toda la "lógica de servidor"
│                    vive aquí y se ejecuta en el cliente.
└─ apps/web          React + Vite. UI + datos locales (IndexedDB) para web, PWA, Android y Windows.
   ├─ android/       Proyecto Capacitor + plugin de GPS en segundo plano.
   └─ src-tauri/     Envoltorio de escritorio Tauri 2.
```

No hay `apps/api`: la app no habla con ningún servidor. Los datos se guardan en **IndexedDB** (Dexie)
y el perfil en el almacenamiento local del navegador.

## Stack

TypeScript 5.9, React 19, Vite 8, React Router 8, TanStack Query 5, Dexie 4 (IndexedDB),
MapLibre GL 6 con teselas de [OpenFreeMap](https://openfreemap.org) (sin clave), µPlot, Inter,
**tesseract.js** (OCR de pantallazos, en el dispositivo). Empaquetado: Capacitor 8, Tauri 2.

## Puesta en marcha

```bash
pnpm install
pnpm --filter @trazo/web dev     # http://localhost:5173
```

No hay base de datos ni variables de entorno obligatorias para desarrollo.

## Scripts

| Comando | Qué hace |
|---|---|
| `pnpm --filter @trazo/web dev` | Arranca la app en desarrollo. |
| `pnpm --filter @trazo/web build` | Compila la PWA → `apps/web/dist/`. |
| `pnpm typecheck` | `tsc --noEmit` en todo el workspace. |
| `pnpm test` | Pruebas de `core` (30) y `web` (7). |
| `pnpm --filter @trazo/web e2e` | Pruebas end-to-end con Playwright (requiere navegadores). |

## Servicios externos

La app no depende de ningún backend propio. Usa dos servicios públicos y gratuitos **directamente
desde el cliente**, solo cuando hace falta:

| Servicio | Uso | Requisito |
|---|---|---|
| OpenFreeMap | Teselas del mapa | Sin clave. |
| Photon (Komoot) | Búsqueda de lugares en el editor de rutas | Sin clave. |
| tesseract.js | OCR de pantallazos | Descarga el motor OCR la primera vez (se cachea); luego offline. |

## Privacidad

Todos los datos (actividades, recorridos, rutas, segmentos, objetivos, perfil, fotos y pantallazos)
se guardan **solo en el dispositivo**. No se envían a ningún servidor, no hay cuenta y no se recopila
información personal. El OCR del pantallazo se ejecuta en el propio navegador. Puedes exportar un
volcado JSON de tus datos o borrarlos por completo desde Ajustes.

## Compilación por plataforma

Ver [`docs/05-plataformas.md`](docs/05-plataformas.md). Resumen:

- **Web / PWA:** `pnpm --filter @trazo/web build` → `dist/` (manifiesto + service worker).
- **Android:** `pnpm --filter @trazo/web build && pnpm --filter @trazo/web android:sync`, luego
  `cd apps/web/android && ./gradlew assembleDebug` (requiere Android SDK + JDK 17).
- **Windows:** `pnpm --filter @trazo/web tauri build` (requiere Rust + toolchain de Windows).
