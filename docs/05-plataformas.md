# 05 · Plataformas: compilación, ejecución y pruebas

Una sola base de UI/lógica (`apps/web`) se distribuye como web, PWA, app Android (Capacitor) y app
de escritorio Windows (Tauri). Este documento reúne los requisitos, los pasos de compilación y las
pruebas de cada plataforma. El estado verificado está en [`../ESTADO.md`](../ESTADO.md).

> **La app es ahora totalmente local** (ver [`06-modo-local.md`](06-modo-local.md)): no hay backend,
> cuenta ni sincronización. Los apartados de este documento que mencionan "la API", `CORS_ORIGINS`,
> `VITE_API_URL` o cuentas/entitlements corresponden al diseño original y **ya no aplican**: el
> empaquetado solo envuelve la web local. Los `device-tests` se escribieron para el flujo con
> registro/login y deben adaptarse (la app local abre directamente, sin crear cuenta).

> Regla del proyecto: no se marca una plataforma como terminada si no compila o si sus funciones
> esenciales están simuladas. Las pruebas que requieren un dispositivo físico se distinguen
> explícitamente de las automatizadas.

---

## Web y PWA

**Requisitos:** Node ≥ 22, pnpm.

```bash
pnpm --filter @trazo/web dev      # desarrollo en http://localhost:5173
pnpm --filter @trazo/web build    # producción → apps/web/dist/
pnpm --filter @trazo/web preview  # sirve el build de producción
```

El build genera el **manifiesto PWA** y el **service worker** (Workbox, vía `vite-plugin-pwa`):
`dist/sw.js`, `dist/manifest.webmanifest` y la precarga de los recursos de la aplicación. Esto habilita
la instalación en navegadores compatibles y el funcionamiento offline de las vistas que operan en local
(historial, detalle de actividades guardadas, grabación con GPS del navegador).

**Estrategia de caché:** *precache* del App Shell + *runtime caching* para teselas del mapa y datos de
solo lectura. La cola de sincronización vive en IndexedDB (Dexie); no depende de Background Sync del
navegador, que no está garantizado.

**Limitaciones del navegador:** una pestaña web no garantiza ejecución en segundo plano con la pantalla
apagada. Para grabaciones largas fiables en móvil se usa la app Android (abajo). En escritorio, la PWA
o la app Tauri mantienen la grabación mientras la ventana está abierta.

---

## Android (Capacitor)

**Requisitos:** Android SDK (plataforma + `platform-tools`), **JDK 17**, variable `ANDROID_HOME`.
Opcional, Android Studio para abrir el proyecto.

```bash
pnpm --filter @trazo/web build          # 1. construye la web en dist/
pnpm --filter @trazo/web android:sync   # 2. cap sync android (copia dist/ y plugins)
cd apps/web/android
./gradlew assembleDebug                  # 3. APK de depuración → app/build/outputs/apk/debug/
# Release firmado:
# ./gradlew assembleRelease   (configura tu keystore en variables.gradle / signingConfigs)
```

Para desarrollo contra una API local sin HTTPS, arranca con `CAP_ALLOW_HTTP=1` (habilita cleartext y
mixed content solo en debug; ver `apps/web/capacitor.config.ts`). El emulador alcanza la API del host
en `http://10.0.2.2:3000`. Añade esos orígenes a `CORS_ORIGINS` en la API.

### GPS en segundo plano — plugin nativo `TrazoTracker`

El adaptador `apps/web/src/platform/tracker.ts` usa el GPS del navegador en web y, en Android, el
plugin nativo (`android/app/src/main/java/app/trazo/mobile/tracker/`):

- **`TrackerService`** — servicio en primer plano (`foregroundServiceType="location"`) con
  notificación persistente en el canal `trazo_recording` ("Grabación de actividades", importancia baja).
  Devuelve `START_STICKY`: si el sistema mata el proceso, Android reinicia el servicio y la grabación
  continúa. Usa `FusedLocationProviderClient` con respaldo de `LocationManager`.
- **`PointStore`** — base SQLite (con WAL) que persiste cada punto GPS inmediatamente, de modo que un
  cierre inesperado no pierde el tramo. Al reabrir la app, los puntos se reconcilian con la sesión.
- **Permisos** (`AndroidManifest.xml`): `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`,
  `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS`, `INTERNET`. Se solicitan en
  el momento correcto (al iniciar una grabación, no al abrir la app).

### Pruebas de dispositivo (no automatizadas en CI)

Requieren un **emulador o dispositivo** con la APK de depuración instalada y abierta, la API accesible,
permisos de ubicación concedidos y `ANDROID_HOME` definido. Se conectan al WebView por ADB + CDP e
inyectan posiciones con los *test providers* de Android. Desde `apps/web`:

```bash
node device-tests/android-background.mjs   # graba 30 s con pantalla encendida + 60 s apagada;
                                           # comprueba notificación persistente, servicio en primer
                                           # plano y que la distancia sigue creciendo (~90·v metros).
node device-tests/android-kill.mjs         # mata el proceso durante la grabación (am crash) y
                                           # verifica reinicio START_STICKY, puntos sin perder y
                                           # recuperación al reabrir.
node device-tests/peek.mjs "<expr JS>"     # inspección puntual del WebView en vivo.
```

Estas pruebas cubren los criterios 3, 5 y 17 de la matriz de aceptación en hardware real.

---

## Windows (Tauri)

**Requisitos:** Rust estable, cadena de compilación de C++ de Windows (Build Tools / Visual Studio) y
WebView2 (preinstalado en Windows 11).

```bash
pnpm --filter @trazo/web tauri dev     # app de escritorio en desarrollo (recarga en caliente)
pnpm --filter @trazo/web tauri build   # instaladores → src-tauri/target/release/bundle/
```

Configuración en `apps/web/src-tauri/tauri.conf.json`:

- **Instaladores:** NSIS (`installMode: currentUser`, idiomas español/inglés) y MSI.
- **Ventana:** 1320×860, mínimo 380×560 (la UI responsive funciona también a tamaño reducido).
- **CSP estricta:** `default-src 'self'`; se permiten explícitamente teselas de OpenFreeMap y las
  conexiones a la API. No se cargan scripts remotos.

El frontend compartido se reutiliza tal cual (`beforeBuildCommand: pnpm build:native`); Tauri solo
añade la integración nativa que aporta valor (diálogos de archivo y sistema de ficheros, vía
`@tauri-apps/plugin-dialog` y `plugin-fs`). La misma cuenta y los mismos datos sincronizados se
comparten con web y Android.

---

## Cuenta y datos entre plataformas

Todas las plataformas hablan con la misma API y comparten cuenta, actividades sincronizadas y
*entitlements* premium (calculados en el backend, nunca por el frontend). Los orígenes de Capacitor
(`https://localhost`) y Tauri (`http(s)://tauri.localhost`) deben figurar en `CORS_ORIGINS` de la API
(ver `apps/api/.env.example`).

## Qué queda para marcar "verificado en dispositivo"

Ejecutar en una máquina con Android SDK y toolchain de Windows: los tres builds nativos, generar los
instaladores y correr los `device-tests`. Hasta entonces, los puntos 17 y 18 de la matriz se consideran
implementados pero no verificados en hardware (ver [`../ESTADO.md`](../ESTADO.md)).
