import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { streamToGpx, type Stream } from '@trazo/core';

const run = Date.now().toString(36);
let n = 0;

async function register(page: Page, label = 'atleta') {
  const username = `${label}_${run}_${++n}`.slice(0, 30);
  await page.goto('/registro');
  await page.getByLabel('Nombre', { exact: true }).fill(`${label} ${n}`);
  await page.getByLabel('Nombre de usuario').fill(username);
  await page.getByLabel('Correo electrónico').fill(`${username}@example.com`);
  await page.getByLabel('Contraseña').fill('contraseña-segura-1');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/ajustes/);
  return { username, displayName: `${label} ${n}` };
}

function gpxFixture(meters = 5000, speed = 10 / 3) {
  const s: Stream = { t: [], lat: [], lng: [], ele: [], seg: [] };
  for (let i = 0; i * speed <= meters; i++) {
    s.t.push(i * 1000);
    s.lat.push(40.4168 + (i * speed) / 111_194.93);
    s.lng.push(-3.7038);
    s.ele!.push(650 + Math.sin(i / 60) * 15);
    s.seg!.push(0);
  }
  return streamToGpx(s, { name: 'Tirada de prueba', sport: 'run', startedAt: Date.parse('2026-10-01T07:30:00Z') });
}

async function importGpx(page: Page, gpx: string) {
  await page.goto('/actividades/importar');
  await page.locator('input[type=file]').setInputFiles({ name: 'tirada.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpx) });
  await expect(page.getByText('Distancia').first()).toBeVisible();
  await page.getByRole('button', { name: 'Guardar actividad' }).click();
  await expect(page).toHaveURL(/\/actividad\//);
}

test.describe('Trazo web', () => {
  test('registro, sesión persistente y tema oscuro', async ({ page }) => {
    await register(page);
    await expect(page.getByText('¡Bienvenido a Trazo!')).toBeVisible();
    await page.getByRole('button', { name: 'Oscuro', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Hola/ })).toBeVisible();
    await page.goto('/ajustes');
    await page.getByRole('button', { name: 'Claro', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('importa GPX, muestra detalle con métricas y gráficos, y aparece en el historial', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && /worker|maplibre|webgl/i.test(m.text())) errors.push(m.text()); });
    await register(page);
    await importGpx(page, gpxFixture());
    await expect(page.getByRole('heading', { name: 'Tirada de prueba' })).toBeVisible();
    await expect(page.getByText('5.00 km').first()).toBeVisible();
    await expect(page.getByText('5:00 /km').first()).toBeVisible();
    await expect(page.getByText('Parciales')).toBeVisible();
    await expect(page.locator('.uplot').first()).toBeVisible();
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();
    await page.waitForTimeout(1500);
    expect(errors).toEqual([]);
    await page.goto('/actividades');
    await expect(page.getByRole('link', { name: /Tirada de prueba/ })).toBeVisible();
    // Sincronizada con el servidor: no queda pendiente.
    await expect(page.getByTitle('Pendiente de sincronizar')).toHaveCount(0, { timeout: 15_000 });
  });

  test('grabación con GPS: iniciar, pausar, reanudar, finalizar y guardar', async ({ page, context }) => {
    test.setTimeout(180_000);
    await context.grantPermissions(['geolocation']);
    let lat = 41.3874;
    const lng = 2.1686;
    await context.setGeolocation({ latitude: lat, longitude: lng, accuracy: 5 });
    await register(page);
    await page.goto('/grabar');
    await page.getByRole('button', { name: 'Carrera', exact: true }).click();
    await page.getByRole('button', { name: /Iniciar carrera/ }).click();
    // ~4 m/s durante 60 s ≈ 240 m.
    for (let i = 0; i < 60; i++) {
      lat += 4 / 111_194.93;
      await context.setGeolocation({ latitude: lat, longitude: lng, accuracy: 5 });
      await page.waitForTimeout(1000);
    }
    await page.getByRole('button', { name: 'Pausar' }).click();
    await expect(page.getByText('En pausa')).toBeVisible();
    // Durante la pausa el movimiento no cuenta.
    lat += 500 / 111_194.93;
    await context.setGeolocation({ latitude: lat, longitude: lng, accuracy: 5 });
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Reanudar' }).click();
    for (let i = 0; i < 10; i++) {
      lat += 4 / 111_194.93;
      await context.setGeolocation({ latitude: lat, longitude: lng, accuracy: 5 });
      await page.waitForTimeout(1000);
    }
    await page.getByRole('button', { name: 'Pausar' }).click();
    // Finalizar exige mantener pulsado.
    const finish = page.getByRole('button', { name: /Mantén pulsado para finalizar/ });
    await finish.click(); // un toque no basta
    await expect(page.getByRole('heading', { name: 'Guardar actividad' })).toHaveCount(0);
    await finish.hover();
    await page.mouse.down();
    await page.waitForTimeout(1300);
    await page.mouse.up();
    await expect(page.getByRole('heading', { name: 'Guardar actividad' })).toBeVisible();
    await page.getByLabel('Título').fill('Rodaje grabado');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page).toHaveURL(/\/actividad\//);
    await expect(page.getByRole('heading', { name: 'Rodaje grabado' })).toBeVisible();
    // Distancia ≈ 280 m (sin los 500 m recorridos en pausa).
    const text = await page.locator('.detail-stats').innerText();
    const m = /(\d+) m\b/.exec(text);
    expect(m).not.toBeNull();
    const meters = Number(m![1]);
    expect(meters).toBeGreaterThan(220);
    expect(meters).toBeLessThan(330);
  });

  test('sin conexión: guarda en local y sincroniza al volver la red, sin duplicar', async ({ page, context }) => {
    await register(page);
    await page.goto('/actividades/importar');
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Manual' }).click();
    await page.getByLabel('Título').fill('Sesión offline');
    await page.getByRole('button', { name: 'Añadir actividad' }).click();
    await expect(page).toHaveURL(/\/actividad\//);
    await expect(page.getByText('Guardada en este dispositivo')).toBeVisible();
    await page.goto('/actividades').catch(() => undefined);
    await context.setOffline(false);
    await page.goto('/actividades');
    await expect(page.getByRole('link', { name: /Sesión offline/ })).toBeVisible();
    await expect(page.getByTitle('Pendiente de sincronizar')).toHaveCount(0, { timeout: 20_000 });
    const res = await page.request.get('/api/activities?limit=50');
    const items = (await res.json()).items as Array<{ name: string }>;
    expect(items.filter((i) => i.name === 'Sesión offline')).toHaveLength(1);
  });

  test('social: seguir, ver en el feed, dar ánimo, comentar y notificar', async ({ page, browser }) => {
    const author = await register(page, 'autora');
    await importGpx(page, gpxFixture(3000));
    await expect(page.getByText('Guardada en este dispositivo')).toHaveCount(0, { timeout: 15_000 });

    const ctx2: BrowserContext = await browser.newContext();
    const p2 = await ctx2.newPage();
    await register(p2, 'fan');
    await p2.goto('/comunidad');
    await p2.getByLabel('Buscar personas o clubes').fill(author.username);
    await p2.getByRole('link', { name: new RegExp(author.displayName) }).first().click();
    await p2.getByRole('button', { name: 'Seguir' }).click();
    await expect(p2.getByRole('button', { name: 'Siguiendo' })).toBeVisible();
    await p2.goto('/');
    await expect(p2.getByRole('heading', { name: 'Tirada de prueba' })).toBeVisible();
    await p2.getByRole('button', { name: 'Dar ánimo' }).first().click();
    await p2.getByRole('link', { name: /Ver Tirada de prueba/ }).first().click();
    await p2.getByLabel('Escribe un comentario').fill('¡Gran ritmo!');
    await p2.getByRole('button', { name: 'Publicar comentario' }).click();
    await expect(p2.getByText('¡Gran ritmo!')).toBeVisible();
    await ctx2.close();

    await page.goto('/notificaciones');
    await expect(page.getByText(/ha empezado a seguirte/)).toBeVisible();
    await expect(page.getByText(/ha dado ánimo/)).toBeVisible();
    await expect(page.getByText(/ha comentado/)).toBeVisible();
  });

  test('PWA: manifiesto y service worker', async ({ page }) => {
    await page.goto('/entrar');
    const manifest = await page.request.get('/manifest.webmanifest');
    expect(manifest.ok()).toBe(true);
    const json = await manifest.json();
    expect(json.name).toBe('Trazo');
    expect(json.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
    const registered = await page.evaluate(async () => {
      const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 10_000))]);
      return !!reg;
    });
    expect(registered).toBe(true);
  });

  test('accesibilidad básica (axe) en entrada, inicio, historial y ajustes', async ({ page }) => {
    await page.goto('/entrar');
    const check = async () => {
      const r = await new AxeBuilder({ page }).disableRules(['region']).analyze();
      const serious = r.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
    };
    await check();
    await register(page);
    for (const path of ['/', '/actividades', '/ajustes', '/progreso']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await check();
    }
  });

  test('móvil: navegación inferior y botón de grabar @mobile', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'solo móvil');
    await register(page);
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Navegación principal' }).last();
    await expect(nav).toBeVisible();
    await expect(page.getByRole('link', { name: 'Grabar actividad' })).toBeVisible();
    await page.screenshot({ path: 'test-results/mobile-inicio.png', fullPage: true });
  });
});
