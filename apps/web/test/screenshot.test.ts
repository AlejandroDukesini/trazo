import { describe, expect, it } from 'vitest';
import { parseScreenshot } from '../src/features/activities/screenshot';

describe('parseScreenshot', () => {
  it('lee un resumen típico en español (coma decimal, tiempo h:m:s)', () => {
    const p = parseScreenshot('Carrera matinal\nDistancia 10,5 km\nTiempo 1:02:30\nDesnivel 145 m\nFC media 152 ppm');
    expect(p.distanceKm).toBe(10.5);
    expect(p.durationS).toBe(3750);
    expect(p.elevM).toBe(145);
    expect(p.avgHr).toBe(152);
  });

  it('lee un resumen en inglés con millas y pies', () => {
    const p = parseScreenshot('Morning Run\n6.2 mi\nMoving Time 48:15\nElevation 320 ft');
    expect(p.distanceKm).toBeCloseTo(9.98, 1);
    expect(p.durationS).toBe(2895);
    expect(p.elevM).toBe(98);
  });

  it('no inventa datos cuando no los encuentra', () => {
    const p = parseScreenshot('Una foto cualquiera sin números relevantes');
    expect(p.distanceKm).toBeUndefined();
    expect(p.durationS).toBeUndefined();
    expect(p.elevM).toBeUndefined();
    expect(p.avgHr).toBeUndefined();
  });

  it('ignora frecuencias cardíacas imposibles', () => {
    const p = parseScreenshot('FC 999 ppm');
    expect(p.avgHr).toBeUndefined();
  });
});
