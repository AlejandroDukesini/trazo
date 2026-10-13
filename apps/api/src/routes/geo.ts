import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { HttpError, parse, unavailable } from '../http.js';
import { requireFeature } from '../services/entitlements.js';

/** Caché LRU mínima en memoria para no repetir consultas a proveedores externos. */
class Lru<V> {
  private map = new Map<string, { v: V; exp: number }>();
  constructor(private max: number, private ttlMs: number) {}
  get(k: string): V | undefined {
    const e = this.map.get(k);
    if (!e) return undefined;
    if (e.exp < Date.now()) { this.map.delete(k); return undefined; }
    this.map.delete(k);
    this.map.set(k, e);
    return e.v;
  }
  set(k: string, v: V) {
    this.map.set(k, { v, exp: Date.now() + this.ttlMs });
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
  }
}

const ORS_PROFILE: Record<string, string> = {
  run: 'foot-walking', trail_run: 'foot-hiking', walk: 'foot-walking', hike: 'foot-hiking',
  ride: 'cycling-road', mtb: 'cycling-mountain',
};

const USER_AGENT = 'Trazo/0.1 (plataforma deportiva; contacto en APP_URL)';

export async function geoRoutes(app: FastifyInstance) {
  const { ctx } = app;
  const cache = new Lru<unknown>(1000, 24 * 3600_000);

  /** Búsqueda de lugares (Photon, datos OpenStreetMap). */
  app.get('/geo/search', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    requireUser(req);
    const q = parse(z.object({ q: z.string().trim().min(2).max(120), lat: z.coerce.number().optional(), lng: z.coerce.number().optional() }), req.query);
    const key = `s:${q.q.toLowerCase()}:${q.lat?.toFixed(1)}:${q.lng?.toFixed(1)}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const url = new URL('/api/', ctx.config.PHOTON_URL);
    url.searchParams.set('q', q.q);
    url.searchParams.set('limit', '8');
    if (q.lat != null && q.lng != null) { url.searchParams.set('lat', String(q.lat)); url.searchParams.set('lon', String(q.lng)); }
    let res: Response;
    try {
      res = await ctx.fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(8000) });
    } catch {
      throw unavailable('geocoder_unavailable', 'El buscador de lugares no responde. Inténtalo de nuevo.');
    }
    if (!res.ok) throw unavailable('geocoder_unavailable', 'El buscador de lugares no está disponible.');
    const data = (await res.json()) as { features?: Array<{ geometry: { coordinates: [number, number] }; properties: Record<string, string> }> };
    const out = (data.features ?? []).map((f) => {
      const p = f.properties;
      return {
        name: p.name ?? p.street ?? q.q,
        label: [p.name, p.city ?? p.town ?? p.village, p.state, p.country].filter(Boolean).join(', '),
        lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0],
      };
    });
    cache.set(key, out);
    return out;
  });

  app.get('/geo/capabilities', async (req) => {
    requireUser(req);
    return { routing: !!ctx.config.ORS_API_KEY, search: true, offlineMaps: false };
  });

  /** Ruta por caminos (OpenRouteService). Requiere Plus y una clave de ORS en el servidor. */
  app.post('/geo/directions', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const user = requireUser(req);
    await requireFeature(ctx, user.id, 'routes.autoRouting');
    if (!ctx.config.ORS_API_KEY) throw unavailable('routing_unavailable', 'El cálculo de rutas automático no está configurado en este servidor.');
    const input = parse(z.object({ sport: z.string(), waypoints: z.array(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })).min(2).max(50) }), req.body);
    const profile = ORS_PROFILE[input.sport] ?? 'foot-walking';
    const key = `d:${profile}:${input.waypoints.map((w) => `${w.lat.toFixed(5)},${w.lng.toFixed(5)}`).join(';')}`;
    const hit = cache.get(key);
    if (hit) return hit;
    let res: Response;
    try {
      res = await ctx.fetch(`https://api.openrouteservice.org/v2/directions/${profile}/geojson`, {
        method: 'POST',
        headers: { authorization: ctx.config.ORS_API_KEY, 'content-type': 'application/json', 'user-agent': USER_AGENT },
        body: JSON.stringify({ coordinates: input.waypoints.map((w) => [w.lng, w.lat]), elevation: true, instructions: false }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw unavailable('routing_unavailable', 'El servicio de rutas no responde.');
    }
    if (res.status === 429) throw new HttpError(429, 'routing_quota', 'Se ha alcanzado el límite del servicio de rutas. Inténtalo más tarde.');
    if (res.status === 404 || res.status === 400) throw new HttpError(422, 'no_route', 'No se encontró una ruta entre esos puntos.');
    if (!res.ok) throw unavailable('routing_unavailable', 'El servicio de rutas no está disponible.');
    const data = (await res.json()) as { features: Array<{ geometry: { coordinates: Array<[number, number, number?]> }; properties: { summary?: { distance?: number }; ascent?: number } }> };
    const f = data.features[0];
    if (!f) throw new HttpError(422, 'no_route', 'No se encontró una ruta.');
    const coords = f.geometry.coordinates;
    const out = {
      lat: coords.map((c) => c[1]), lng: coords.map((c) => c[0]), ele: coords.map((c) => c[2] ?? null),
      distanceM: f.properties.summary?.distance ?? null, ascentM: f.properties.ascent ?? null,
      attribution: '© openrouteservice.org | © OpenStreetMap contributors',
    };
    cache.set(key, out);
    return out;
  });
}
