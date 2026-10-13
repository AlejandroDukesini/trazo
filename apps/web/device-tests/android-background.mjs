// Prueba en emulador/dispositivo Android: grabación con la pantalla apagada.
// Requisitos: APK de depuración instalado y abierto, API accesible desde el dispositivo, permisos de ubicación concedidos.
// Uso: node device-tests/android-background.mjs   (ver docs/05-plataformas.md)
import { execFileSync } from 'node:child_process';

const ADB = process.env.ADB ?? `${process.env.ANDROID_HOME}/platform-tools/adb.exe`;
const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const M = 111_194.93;
let lat = 40.4168;
const lng = -3.7038;
// Proveedores de prueba de Android (funcionan también con el emulador sin ventana).
adb('shell', 'appops', 'set', 'com.android.shell', 'android:mock_location', 'allow');
for (const p of ['gps', 'fused']) {
  try { adb('shell', 'cmd', 'location', 'providers', 'add-test-provider', p); } catch { /* ya existe */ }
  adb('shell', 'cmd', 'location', 'providers', 'set-test-provider-enabled', p, 'true');
}
const fix = () => {
  for (const p of ['gps', 'fused']) adb('shell', 'cmd', 'location', 'providers', 'set-test-provider-location', p, '--location', `${lat.toFixed(7)},${lng}`, '--accuracy', '5');
};

adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
const pid = adb('shell', 'pidof', 'app.trazo.mobile');
adb('forward', 'tcp:9333', `localabstract:webview_devtools_remote_${pid}`);
const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
const target = targets.find((t) => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}
async function waitFor(cond, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await js(`return !!(${cond})`)) return; await sleep(300); }
  throw new Error(`Timeout esperando: ${cond}`);
}
// Utilidades en la página: rellenar inputs controlados por React y pulsar botones por texto.
const HELPERS = `
  window.__fill = (label, value) => {
    const l = [...document.querySelectorAll('label')].find((x) => x.textContent.trim() === label);
    const el = document.getElementById(l.htmlFor);
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  window.__btn = (re) => [...document.querySelectorAll('button')].find((b) => new RegExp(re).test((b.getAttribute('aria-label') || '') + ' ' + b.textContent));
`;
const go = async (path) => { await js(`location.href = 'https://localhost${path}'`); await sleep(2500); await js(HELPERS); };

console.log('WebView:', target.url);
const user = `and_${Date.now().toString(36)}`;
await go('/registro');
await waitFor(`document.querySelector('form') || location.pathname !== '/registro'`);
if (await js(`return location.pathname === '/registro'`)) {
  await waitFor(`document.querySelector('form')`);
  await js(`__fill('Nombre', 'Android Test'); __fill('Nombre de usuario', '${user}'); __fill('Correo electrónico', '${user}@example.com'); __fill('Contraseña', 'contraseña-segura-1'); __btn('Crear cuenta').click();`);
  await waitFor(`location.pathname.startsWith('/ajustes')`);
  console.log('Registrado:', user);
} else console.log('Sesión ya iniciada');

await go('/grabar');
await waitFor(`__btn('^\\s*Carrera$') || __btn('Iniciar')`);
for (let i = 0; i < 5; i++) { fix(); await sleep(1000); }
await js(`__btn('Iniciar').click()`);
await waitFor(`__btn('Pausar')`);
console.log('Grabando…');

const step = 4;
for (let i = 0; i < 30; i++) { lat += step / M; fix(); await sleep(1000); }
console.log('Pantalla encendida 30 s →', (await js(`return document.querySelector('.rec__grid').innerText`)).replace(/\s+/g, ' '));

adb('shell', 'input', 'keyevent', 'KEYCODE_SLEEP');
await sleep(1500);
console.log('Pantalla:', adb('shell', 'dumpsys', 'power').match(/mWakefulness=(\w+)/)?.[1]);
for (let i = 0; i < 60; i++) { lat += step / M; fix(); await sleep(1000); }
const notif = adb('shell', 'dumpsys', 'notification', '--noredact').includes('trazo_recording');
const fgs = /isForeground=true/.test(adb('shell', 'dumpsys', 'activity', 'services', 'app.trazo.mobile'));
console.log('Notificación persistente:', notif, '· servicio en primer plano:', fgs);
adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
await sleep(4000);
console.log('Tras 60 s con pantalla apagada →', (await js(`return document.querySelector('.rec__grid').innerText`)).replace(/\s+/g, ' '));

await js(`__btn('Pausar').click()`);
await waitFor(`__btn('Mantén pulsado para finalizar')`);
await js(`__btn('Mantén pulsado para finalizar').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
await sleep(1400);
await waitFor(`[...document.querySelectorAll('h1')].some((h) => h.textContent === 'Guardar actividad')`);
await js(`__fill('Título', 'Prueba pantalla apagada'); [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Guardar').click();`);
await waitFor(`location.pathname.startsWith('/actividad/')`);
await sleep(5000);
await js(HELPERS);
console.log('Actividad guardada →', (await js(`return document.querySelector('.detail-stats')?.innerText`))?.replace(/\s+/g, ' ').slice(0, 140));
console.log('Sincronización →', await js(`return document.querySelector('.sync-pill')?.innerText ?? ''`));
console.log(`Esperado ≈ ${90 * step} m (30 s + 60 s a ${step} m/s)`);
ws.close();
