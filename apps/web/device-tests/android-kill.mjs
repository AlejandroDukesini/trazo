// Prueba de recuperación: se mata el proceso de la app durante la grabación (am crash).
// Comprueba que el servicio se reinicia (START_STICKY), que sigue guardando puntos y que al
// reabrir la app la grabación se recupera sin perder el tramo intermedio.
import { execFileSync } from 'node:child_process';

const ADB = process.env.ADB ?? `${process.env.ANDROID_HOME}/platform-tools/adb.exe`;
const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const M = 111_194.93;
let lat = 40.4200;
const lng = -3.7000;
const fix = () => { for (const p of ['gps', 'fused']) adb('shell', 'cmd', 'location', 'providers', 'set-test-provider-location', p, '--location', `${lat.toFixed(7)},${lng}`, '--accuracy', '5'); };

async function connect() {
  const pid = adb('shell', 'pidof', 'app.trazo.mobile');
  adb('forward', 'tcp:9333', `localabstract:webview_devtools_remote_${pid}`);
  const t = (await (await fetch('http://127.0.0.1:9333/json')).json()).find((x) => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); pend.get(m.id)?.(m); pend.delete(m.id); });
  const js = async (expr) => {
    const r = await new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true } })); });
    return r.result?.result?.value;
  };
  return { ws, js, pid };
}
const btn = (re) => `[...document.querySelectorAll('button')].find((b) => new RegExp(${JSON.stringify(re)}).test((b.getAttribute('aria-label') || '') + ' ' + b.textContent))`;

adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
let c = await connect();
await c.js(`location.href = 'https://localhost/grabar'`);
await sleep(4000);
c = await connect();
// Limpia una grabación anterior si la hubiera.
if (await c.js(`return !!${btn('Pausar|Reanudar')}`)) {
  await c.js(`${btn('Pausar')}?.click()`); await sleep(800);
  await c.js(`${btn('Mantén pulsado para finalizar')}.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`); await sleep(1500);
  await c.js(`${btn('Descartar')}.click()`); await sleep(800);
  await c.js(`[...document.querySelectorAll('dialog button')].find((b) => b.textContent.trim() === 'Descartar').click()`); await sleep(2500);
  await c.js(`location.href = 'https://localhost/grabar'`); await sleep(4000);
  c = await connect();
}
for (let i = 0; i < 3; i++) { fix(); await sleep(1000); }
await c.js(`${btn('Iniciar')}.click()`);
await sleep(1500);
for (let i = 0; i < 20; i++) { lat += 4 / M; fix(); await sleep(1000); }
console.log('Antes del cierre →', (await c.js(`return document.querySelector('.rec__grid')?.innerText`))?.replace(/\s+/g, ' '));
c.ws.close();
const pid = adb('shell', 'pidof', 'app.trazo.mobile');
adb('shell', 'am', 'crash', 'app.trazo.mobile');
console.log('Cierre inesperado forzado del proceso', pid);
for (let i = 0; i < 40; i++) {
  lat += 4 / M; fix(); await sleep(1000);
}
let svc = '';
try { svc = adb('shell', 'pidof', 'app.trazo.mobile'); } catch { /* no reiniciado */ }
console.log('Proceso tras 40 s:', svc || '(no reiniciado)');
adb('shell', 'monkey', '-p', 'app.trazo.mobile', '-c', 'android.intent.category.LAUNCHER', '1');
await sleep(8000);
c = await connect();
await sleep(8000);
console.log('Pantalla tras reabrir:', await c.js(`return location.pathname`));
console.log('Tras recuperar →', (await c.js(`return document.querySelector('.rec__grid')?.innerText`))?.replace(/\s+/g, ' '));
console.log('Esperado ≈ 240 m (80 m antes + 160 m durante el cierre; si el servicio no se reinicia a tiempo, ese tramo se une en línea recta).');
await c.js(`${btn('Pausar')}?.click()`);
c.ws.close();
