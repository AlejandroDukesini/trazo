import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { streamToGpx, type Stream } from '@trazo/core';

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
  await page.locator('input[type=file]').first().setInputFiles({ name: 'tirada.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpx) });
  await expect(page.getByText('Distancia').first()).toBeVisible();
  await page.getByRole('button', { name: 'Guardar actividad' }).click();
  await expect(page).toHaveURL(/\/actividad\//);
}

test.describe('Trazo web (local)', () => {
  test('abre sin cuenta y recuerda el tema oscuro', async ({ page }) => {
    await page.goto('/');
    // No hay inicio de sesión: la app abre directamente en el historial.
    await expect(page).toHaveURL(/\/(actividades)?$/);
    await page.goto('/ajustes');
    await page.getByRole('button', { name: 'Oscuro', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Claro', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('importa GPX, muestra detalle con métricas y gráficos, y aparece en el historial', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && /worker|maplibre|webgl/i.test(m.text())) errors.push(m.text()); });
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
  });

  test('añade actividad manual y aparece en el historial (funciona sin conexión)', async ({ page, context }) => {
    await page.goto('/actividades/importar');
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Manual' }).click();
    await page.getByLabel('Título').fill('Sesión local');
    await page.getByRole('button', { name: 'Guardar actividad' }).click();
    await expect(page).toHaveURL(/\/actividad\//);
    await expect(page.getByRole('heading', { name: 'Sesión local' })).toBeVisible();
    await context.setOffline(false);
    await page.goto('/actividades');
    await expect(page.getByRole('link', { name: /Sesión local/ })).toBeVisible();
  });

  test('importar por pantallazo: la opción está disponible en Ajustes e Importar', async ({ page }) => {
    await page.goto('/ajustes');
    await expect(page.getByRole('button', { name: /Desde un pantallazo/ })).toBeVisible();
    await page.goto('/actividades/importar?modo=pantallazo');
    await expect(page.getByText(/se lee en este dispositivo/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Elegir imagen/ })).toBeVisible();
  });

  test('grabación con GPS: iniciar, pausar, reanudar, finalizar y guardar', async ({ page, context }) => {
    test.setTimeout(180_000);
    await context.grantPermissions(['geolocation']);
    let lat = 41.3874;
    const lng = 2.1686;
    await context.setGeolocation({ latitude: lat, longitude: lng, accuracy: 5 });
    await page.goto('/grabar');
    await page.getByRole('button', { name: 'Carrera', exact: true }).click();
    await page.getByRole('button', { name: /Iniciar carrera/ }).click();
    for (let i = 0; i < 60; i++) {
      lat += 4 / 111_194.93;
      await context.setGeolocation({ latitude: lat, longitude: lng, accuracy: 5 });
      await page.waitForTimeout(1000);
    }
    await page.getByRole('button', { name: 'Pausar' }).click();
    await expect(page.getByText('En pausa')).toBeVisible();
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
    const finish = page.getByRole('button', { name: /Mantén pulsado para finalizar/ });
    await finish.click();
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
    const text = await page.locator('.detail-stats').innerText();
    const m = /(\d+) m\b/.exec(text);
    expect(m).not.toBeNull();
    const meters = Number(m![1]);
    expect(meters).toBeGreaterThan(220);
    expect(meters).toBeLessThan(330);
  });

  test('PWA: manifiesto y service worker', async ({ page }) => {
    await page.goto('/');
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

  test('accesibilidad básica (axe) en inicio, historial, ajustes y progreso', async ({ page }) => {
    const check = async () => {
      const r = await new AxeBuilder({ page }).disableRules(['region']).analyze();
      const serious = r.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
    };
    for (const path of ['/', '/actividades', '/ajustes', '/progreso']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await check();
    }
  });

  test('móvil: navegación inferior y botón de grabar @mobile', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'solo móvil');
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Navegación principal' }).last();
    await expect(nav).toBeVisible();
    await expect(page.getByRole('link', { name: 'Grabar actividad' })).toBeVisible();
    await page.screenshot({ path: 'test-results/mobile-inicio.png', fullPage: true });
  });
});
