import { expect, test } from '@playwright/test';
import { streamToGpx, type Stream } from '@trazo/core';

// Capturas para revisión visual: SCREENS=1 npx playwright test screens
test.skip(!process.env.SCREENS, 'solo bajo demanda');

test('capturas', async ({ page }, info) => {
  test.setTimeout(120_000);
  const u = `vis_${Date.now().toString(36)}`;
  await page.goto('/registro');
  await page.screenshot({ path: `screens/${info.project.name}-registro.png` });
  await page.getByLabel('Nombre', { exact: true }).fill('Laura Méndez');
  await page.getByLabel('Nombre de usuario').fill(u);
  await page.getByLabel('Correo electrónico').fill(`${u}@example.com`);
  await page.getByLabel('Contraseña').fill('contraseña-segura-1');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/ajustes/);
  for (let k = 0; k < 3; k++) {
    const s: Stream = { t: [], lat: [], lng: [], ele: [], seg: [] };
    for (let i = 0; i < 2400; i++) {
      s.t.push(i * 1000);
      s.lat.push(40.4168 + Math.sin(i / 300) * 0.01 + k * 0.002);
      s.lng.push(-3.7038 + i * 0.000035);
      s.ele!.push(650 + Math.sin(i / 200) * 25);
      s.seg!.push(0);
    }
    const gpx = streamToGpx(s, { name: ['Rodaje por el Retiro', 'Series en pista', 'Tirada larga'][k]!, sport: 'run', startedAt: Date.now() - (k + 1) * 86_400_000 });
    await page.goto('/actividades/importar');
    await page.locator('input[type=file]').setInputFiles({ name: 'a.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpx) });
    await page.getByRole('button', { name: 'Guardar actividad' }).click();
    await expect(page).toHaveURL(/actividad\//);
  }
  await page.waitForTimeout(3000);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => localStorage.setItem('trazo-theme', t), theme);
    for (const [name, path] of [['inicio', '/'], ['actividades', '/actividades'], ['progreso', '/progreso'], ['grabar', '/grabar'], ['ajustes', '/ajustes']] as const) {
      await page.goto(path);
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `screens/${info.project.name}-${theme}-${name}.png` });
    }
    await page.goto('/actividades');
    await page.getByRole('link', { name: /Tirada larga/ }).first().click();
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `screens/${info.project.name}-${theme}-detalle.png`, fullPage: true });
  }
});
