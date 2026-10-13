# 01 · Investigación previa

Fecha: 2026-10-12. Estado del repositorio al empezar: **vacío** (sin código que conservar).

## 1. Referencia funcional (Strava) y límites legales

Strava se estudia **solo como referencia funcional**. Conclusiones:

- **No usamos la API de Strava.** El *API Agreement* (strava.com/legal/api) dice textualmente:
  *"You may not create applications that compete with or replicate Strava functionality."*
  Desde noviembre de 2024 además prohíbe mostrar datos de Strava a otros usuarios y usarlos en IA/analítica.
  → Toda la funcionalidad es propia; la importación de actividades se hace con **archivos GPX/TCX que el usuario aporta**.
- **Sin marca, textos, iconos ni colores de Strava.** Producto propio: **Trazo**, acento turquesa-lima, tipografía Inter.
- Oferta pública observada (fuentes secundarias, precios cambiantes): nivel gratuito con registro, kudos,
  comentarios, retos y estadísticas básicas; suscripción con planes de entrenamiento, planificador de rutas avanzado,
  clasificaciones completas de segmentos, análisis avanzado y predicciones. Precio orientativo ~12 USD/mes u ~80 USD/año.
  **No fijamos precios**: se configuran en `packages/core/src/plans.ts` + variables del proveedor de pagos.

## 2. Plataformas

| Tema | Realidad comprobada | Decisión |
|---|---|---|
| GPS en PWA | `watchPosition` deja de entregar posiciones con pantalla apagada / pestaña en segundo plano (Chrome Android, Safari). Los service workers no tienen geolocalización. | La PWA graba **solo en primer plano** + Wake Lock + aviso explícito. Persistencia de cada punto en IndexedDB para no perder nada. |
| GPS en Android | Requiere **servicio en primer plano** `foregroundServiceType="location"` con notificación persistente, `ACCESS_FINE_LOCATION`, `POST_NOTIFICATIONS` (13+), `FOREGROUND_SERVICE_LOCATION` (14+). | **Plugin Capacitor propio en Kotlin** (`TrazoTracker`): FusedLocationProvider + servicio en primer plano + persistencia nativa en SQLite. El WebView puede morir sin perder puntos; la capa JS los drena al volver. |
| Plugins de terceros | `@capacitor-community/background-geolocation` (v1, compatibilidad oficial hasta Capacitor 7, menos preciso). Capawesome: solo con licencia de pago *Insiders*. | Plugin propio: sin coste, sin dependencia de compatibilidad, control total de la persistencia. |
| Persistencia web | IndexedDB es la única opción estructurada robusta; Safari puede expulsar datos de webs no instaladas tras 7 días sin uso. | Dexie (IndexedDB) + `navigator.storage.persist()`. Servidor = fuente de verdad para datos sociales. |
| Windows | PWA instalable desde Edge/Chrome funciona bien. Tauri 2 aporta instalador MSI/NSIS firmable, distribución sin navegador, diálogo nativo de archivos, tamaño ~10 MB (usa WebView2). | Se ofrecen ambas. Tauri con integración mínima (ventana, diálogos). |

## 3. Proveedores externos evaluados

| Necesidad | Opción elegida | Coste / límites | Alternativas |
|---|---|---|---|
| Teselas de mapa | **OpenFreeMap** (vectorial, estilo `liberty`/`dark`), MapLibre GL JS | Gratis, sin clave, uso comercial permitido según su FAQ; servicio "tal cual" sin SLA. **No permite** descarga masiva para offline. | MapTiler (clave, plan gratuito limitado, permite offline con licencia), Stadia Maps, autoalojar Planetiler/PMTiles (coste de servidor, offline posible). |
| Rutas (routing) | **OpenRouteService** vía backend (clave en servidor) | Plan gratuito: 2 000 directions/día, 40/min. | GraphHopper (cloud o autoalojado), BRouter (autoalojado, gratis, excelente para bici). |
| Geocodificación | **Photon** (komoot) vía backend proxy con caché | Público, sin clave, uso justo. | ORS geocode (1 000/día), Nominatim (política de uso muy restrictiva: 1 req/s, sin autocompletar). |
| Elevación | Elevación del GPS / archivo + ORS elevation para rutas planificadas | 2 000 puntos/día gratis | Open-Topo-Data autoalojado. |
| Pagos web | **Stripe** Checkout + Customer Portal + webhooks firmados | Comisión por transacción; modo test gratuito. | Paddle / Lemon Squeezy (merchant of record, simplifican IVA). |
| Pagos Android | **Google Play Billing** (obligatorio para bienes digitales en Play) | 15 % suscripciones | — Pendiente de cuenta Play Console. |
| Almacenamiento fotos | Disco local en desarrollo; adaptador S3-compatible (Cloudflare R2 / S3) en producción | R2: sin egress | — |
| Base de datos | PostgreSQL 16+ | Gestionado: Neon, Supabase, RDS… | PostGIS no requerido (geometría resuelta en `core`). |

**Mapas offline**: OpenFreeMap no autoriza descarga masiva de teselas. La función queda diseñada (premium) y
**desactivada** hasta contratar un proveedor con licencia offline o autoalojar PMTiles. Ver `03-decisiones.md`.

## Fuentes

- Strava API Agreement — https://www.strava.com/legal/api
- Cambios API 2024 — https://dcrainmaker.com/2024/11/stravas-changes-to-kill-off-apps.html
- Precios Strava (secundaria) — https://www.wareable.com/sport/is-strava-premium-worth-it
- OpenFreeMap — https://openfreemap.org
- OpenRouteService planes — https://openrouteservice.org/plans/
- Capawesome Background Geolocation — https://capawesome.io/docs/sdks/capacitor/background-geolocation/
- Community background-geolocation README — https://cdn.jsdelivr.net/npm/@capacitor-community/background-geolocation@1.2.26/README.md
- Limitaciones geolocalización PWA — https://progressier.com/pwa-capabilities/geolocation
