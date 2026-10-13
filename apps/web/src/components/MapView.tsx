import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MLMap, StyleSpecification } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useTheme } from '../app/theme';

// MapLibre 6 ejecuta el procesado de teselas en un worker independiente: se publica como recurso propio.
maplibregl.setWorkerUrl(workerUrl);
export interface Track {
  id: string;
  lat: number[];
  lng: number[];
  color?: string;
  width?: number;
  opacity?: number;
  /** Tramos (índice por punto): se dibujan sin unir huecos de pausas o zonas privadas. */
  seg?: number[];
}

export interface Waypoint {
  lat: number;
  lng: number;
}

interface Props {
  tracks: Track[];
  /** Posición resaltada (cursor del gráfico). */
  highlight?: { lat: number; lng: number } | null;
  /** Posición actual en directo (grabación). */
  live?: { lat: number; lng: number; accuracy?: number | null } | null;
  /** Seguir la posición en directo. */
  follow?: boolean;
  waypoints?: Waypoint[];
  onWaypointDrag?: (index: number, p: Waypoint) => void;
  onWaypointClick?: (index: number) => void;
  onMapClick?: (p: Waypoint) => void;
  /** Cambia este valor para reencuadrar en los recorridos. */
  fitKey?: string | number;
  interactive?: boolean;
  className?: string;
  label?: string;
  /** Centra el mapa (p. ej. tras buscar un lugar). */
  center?: { lat: number; lng: number; zoom?: number; key: number } | null;
}

const STYLE_URL = { light: 'https://tiles.openfreemap.org/styles/positron', dark: 'https://tiles.openfreemap.org/styles/dark' };

/** Estilo mínimo sin teselas: el recorrido sigue visible sin conexión o si el proveedor falla. */
function offlineStyle(theme: 'light' | 'dark'): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': theme === 'dark' ? '#151a21' : '#eef0f3' } }],
  };
}

function cssVar(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function toGeoJSON(t: Track): { type: 'Feature'; properties: Record<string, never>; geometry: { type: 'MultiLineString'; coordinates: number[][][] } } {
  const lines: number[][][] = [];
  let cur: number[][] = [];
  for (let i = 0; i < t.lat.length; i++) {
    if (i > 0 && t.seg && t.seg[i] !== t.seg[i - 1]) {
      if (cur.length > 1) lines.push(cur);
      cur = [];
    }
    cur.push([t.lng[i]!, t.lat[i]!]);
  }
  if (cur.length > 1) lines.push(cur);
  return { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } };
}

function boundsOf(tracks: Track[]): maplibregl.LngLatBounds | null {
  let b: maplibregl.LngLatBounds | null = null;
  for (const t of tracks) {
    for (let i = 0; i < t.lat.length; i++) {
      const p: [number, number] = [t.lng[i]!, t.lat[i]!];
      if (!b) b = new maplibregl.LngLatBounds(p, p);
      else b.extend(p);
    }
  }
  return b;
}

function dot(color: string, size: number, ring = '#fff') {
  const el = document.createElement('div');
  el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${color};border:3px solid ${ring};box-shadow:0 1px 4px rgba(0,0,0,.35)`;
  return el;
}

export function MapView({ tracks, highlight, live, follow, waypoints, onWaypointDrag, onWaypointClick, onMapClick, fitKey, interactive = true, className, label = 'Mapa', center }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(0);
  const { theme } = useTheme();
  const markers = useRef<{ start?: maplibregl.Marker; end?: maplibregl.Marker; hl?: maplibregl.Marker; live?: maplibregl.Marker; wps: maplibregl.Marker[] }>({ wps: [] });
  const cbs = useRef({ onWaypointDrag, onWaypointClick, onMapClick });
  cbs.current = { onWaypointDrag, onWaypointClick, onMapClick };
  const [offline, setOffline] = useState(!navigator.onLine);

  // Creación del mapa (una vez).
  useEffect(() => {
    if (!container.current) return;
    const m = new maplibregl.Map({
      container: container.current,
      style: navigator.onLine ? STYLE_URL[theme] : offlineStyle(theme),
      center: [-3.7, 40.4],
      zoom: 4,
      interactive,
      attributionControl: { compact: true },
      cooperativeGestures: false,
      pitchWithRotate: false,
      dragRotate: false,
    });
    if (interactive) m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('style.load', () => setReady((n) => n + 1));
    m.on('error', (e: { error?: { message?: string } }) => {
      // Fallo de estilo/teselas (sin red, cuota): se pasa al estilo sin teselas.
      if (String(e.error?.message ?? '').match(/Failed to fetch|NetworkError|style/i) && !m.isStyleLoaded()) {
        setOffline(true);
        m.setStyle(offlineStyle(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'));
      }
    });
    m.on('click', (e: maplibregl.MapMouseEvent) => cbs.current.onMapClick?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
    map.current = m;
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(container.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cambio de tema → cambio de estilo (las capas se reponen en style.load).
  const styleKey = useRef(`${theme}:${offline}`);
  useEffect(() => {
    const m = map.current;
    if (!m || styleKey.current === `${theme}:${offline}`) return;
    styleKey.current = `${theme}:${offline}`;
    m.setStyle(offline || !navigator.onLine ? offlineStyle(theme) : STYLE_URL[theme]);
  }, [theme, offline]);

  // Capas de recorridos.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !m.style?._loaded) return;
    const accent = cssVar('--accent', '#0c9c85');
    const seen = new Set<string>();
    for (const t of tracks) {
      const id = `trk-${t.id}`;
      seen.add(id);
      const data = toGeoJSON(t);
      const src = m.getSource(id) as GeoJSONSource | undefined;
      if (src) src.setData(data);
      else {
        m.addSource(id, { type: 'geojson', data });
        m.addLayer({ id: `${id}-casing`, type: 'line', source: id, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': theme === 'dark' ? '#0d1015' : '#ffffff', 'line-width': (t.width ?? 4) + 3, 'line-opacity': t.opacity ?? 1 } });
        m.addLayer({ id, type: 'line', source: id, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': t.color ?? accent, 'line-width': t.width ?? 4, 'line-opacity': t.opacity ?? 1 } });
      }
    }
    for (const layer of m.getStyle().layers ?? []) {
      if (layer.id.startsWith('trk-') && !layer.id.endsWith('-casing') && !seen.has(layer.id)) {
        m.removeLayer(`${layer.id}-casing`);
        m.removeLayer(layer.id);
        m.removeSource(layer.id);
      }
    }
    // Inicio y fin del primer recorrido.
    const first = tracks[0];
    const mk = markers.current;
    mk.start?.remove();
    mk.end?.remove();
    mk.start = mk.end = undefined;
    if (first && first.lat.length > 1 && !waypoints) {
      mk.start = new maplibregl.Marker({ element: dot('#18a957', 14) }).setLngLat([first.lng[0]!, first.lat[0]!]).addTo(m);
      if (!live) mk.end = new maplibregl.Marker({ element: dot('#e5484d', 14) }).setLngLat([first.lng.at(-1)!, first.lat.at(-1)!]).addTo(m);
    }
  }, [tracks, ready, theme, waypoints, live]);

  // Encuadre.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const b = boundsOf(tracks);
    if (b) m.fitBounds(b, { padding: 36, maxZoom: 16, duration: 0 });
    else if (waypoints?.length) m.flyTo({ center: [waypoints[0]!.lng, waypoints[0]!.lat], zoom: 13, duration: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, ready > 0]);

  useEffect(() => {
    if (center && map.current) map.current.flyTo({ center: [center.lng, center.lat], zoom: center.zoom ?? 14, duration: 800 });
  }, [center]);

  // Marcador de cursor del gráfico.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const mk = markers.current;
    if (!highlight) {
      mk.hl?.remove();
      mk.hl = undefined;
      return;
    }
    if (!mk.hl) mk.hl = new maplibregl.Marker({ element: dot(cssVar('--text', '#111'), 14) }).setLngLat([highlight.lng, highlight.lat]).addTo(m);
    else mk.hl.setLngLat([highlight.lng, highlight.lat]);
  }, [highlight]);

  // Posición en directo.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const mk = markers.current;
    if (!live) {
      mk.live?.remove();
      mk.live = undefined;
      return;
    }
    if (!mk.live) mk.live = new maplibregl.Marker({ element: dot(cssVar('--accent', '#0c9c85'), 18) }).setLngLat([live.lng, live.lat]).addTo(m);
    else mk.live.setLngLat([live.lng, live.lat]);
    if (follow) m.easeTo({ center: [live.lng, live.lat], zoom: Math.max(m.getZoom(), 15), duration: 600 });
  }, [live, follow]);

  // Puntos de paso editables (editor de rutas).
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const mk = markers.current;
    mk.wps.forEach((w) => w.remove());
    mk.wps = (waypoints ?? []).map((w, i, all) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'wp-marker' + (i === 0 ? ' is-start' : i === all.length - 1 ? ' is-end' : '');
      el.textContent = i === 0 ? 'A' : i === all.length - 1 ? 'B' : String(i);
      el.setAttribute('aria-label', `Punto ${i + 1}`);
      let dragging = false;
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (!dragging) cbs.current.onWaypointClick?.(i);
      });
      const marker = new maplibregl.Marker({ element: el, draggable: !!onWaypointDrag }).setLngLat([w.lng, w.lat]).addTo(m);
      marker.on('dragstart', () => { dragging = true; });
      marker.on('dragend', () => {
        setTimeout(() => { dragging = false; }, 80);
        const p = marker.getLngLat();
        cbs.current.onWaypointDrag?.(i, { lat: p.lat, lng: p.lng });
      });
      return marker;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waypoints]);

  return (
    <div className={['map', className].filter(Boolean).join(' ')} role="region" aria-label={label}>
      <div ref={container} className="map__canvas" />
      {offline && <div className="map__offline">Mapa base no disponible sin conexión</div>}
    </div>
  );
}
