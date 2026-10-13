import { MILE_M } from './metrics.js';
import { getSport } from './sports.js';

export type Units = 'metric' | 'imperial';
const FT = 0.3048;

export function formatDuration(totalS: number, opts: { compact?: boolean } = {}): string {
  const s = Math.max(0, Math.round(totalS));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (opts.compact) {
    if (h) return `${h} h ${m} min`;
    if (m) return `${m} min`;
    return `${sec} s`;
  }
  const mm = String(m).padStart(h ? 2 : 1, '0'), ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDistance(m: number, units: Units = 'metric', digits = 2): string {
  if (units === 'imperial') return `${(m / MILE_M).toFixed(digits)} mi`;
  if (m < 1000 && digits > 0) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(digits)} km`;
}

export function distanceValue(m: number, units: Units = 'metric'): number {
  return units === 'imperial' ? m / MILE_M : m / 1000;
}

export const distanceUnit = (units: Units) => (units === 'imperial' ? 'mi' : 'km');

/** Ritmo a partir de velocidad (m/s): "4:35 /km". */
export function formatPace(speed: number | null | undefined, units: Units = 'metric'): string {
  if (!speed || speed < 0.1) return '–';
  const unit = units === 'imperial' ? MILE_M : 1000;
  const s = unit / speed;
  if (s > 3600) return '–';
  return `${formatDuration(s)} /${distanceUnit(units)}`;
}

export function formatSpeed(speed: number | null | undefined, units: Units = 'metric'): string {
  if (speed == null) return '–';
  return units === 'imperial' ? `${(speed * 2.236936).toFixed(1)} mph` : `${(speed * 3.6).toFixed(1)} km/h`;
}

/** Ritmo o velocidad según el deporte. */
export function formatSportSpeed(sport: string, speed: number | null | undefined, units: Units = 'metric'): string {
  return getSport(sport).display === 'pace' ? formatPace(speed, units) : formatSpeed(speed, units);
}

export function formatElevation(m: number | null | undefined, units: Units = 'metric'): string {
  if (m == null) return '–';
  return units === 'imperial' ? `${Math.round(m / FT)} ft` : `${Math.round(m)} m`;
}
