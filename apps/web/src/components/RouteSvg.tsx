import { decodePolyline } from '@trazo/core';
import { memo, useMemo } from 'react';

/**
 * Vista previa ligera del recorrido (SVG, sin teselas): permite listas y feeds largos sin crear
 * decenas de mapas WebGL. Proyección equirectangular local con corrección de latitud.
 */
export const RouteSvg = memo(function RouteSvg({ polyline, lat, lng, className, height = 160 }: { polyline?: string | null; lat?: number[]; lng?: number[]; className?: string; height?: number }) {
  const path = useMemo(() => {
    let pts: Array<[number, number]>;
    if (polyline) pts = decodePolyline(polyline);
    else if (lat && lng) pts = lat.map((la, i) => [la, lng[i]!]);
    else return null;
    if (pts.length < 2) return null;
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const [la, ln] of pts) {
      minLat = Math.min(minLat, la); maxLat = Math.max(maxLat, la);
      minLng = Math.min(minLng, ln); maxLng = Math.max(maxLng, ln);
    }
    const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
    const w = Math.max((maxLng - minLng) * k, 1e-6), h = Math.max(maxLat - minLat, 1e-6);
    const W = 400, H = 220, pad = 18;
    const s = Math.min((W - 2 * pad) / w, (H - 2 * pad) / h);
    const ox = (W - w * s) / 2, oy = (H - h * s) / 2;
    const step = Math.max(1, Math.floor(pts.length / 600));
    let d = '';
    for (let i = 0; i < pts.length; i += step) {
      const [la, ln] = pts[i]!;
      d += `${i === 0 ? 'M' : 'L'}${(ox + (ln - minLng) * k * s).toFixed(1)} ${(oy + (maxLat - la) * s).toFixed(1)}`;
    }
    const [la0, ln0] = pts[0]!, [la1, ln1] = pts[pts.length - 1]!;
    return {
      d: d + `L${(ox + (ln1 - minLng) * k * s).toFixed(1)} ${(oy + (maxLat - la1) * s).toFixed(1)}`,
      start: [ox + (ln0 - minLng) * k * s, oy + (maxLat - la0) * s],
      end: [ox + (ln1 - minLng) * k * s, oy + (maxLat - la1) * s],
    };
  }, [polyline, lat, lng]);
  if (!path) return null;
  return (
    <svg className={['route-svg', className].filter(Boolean).join(' ')} viewBox="0 0 400 220" preserveAspectRatio="xMidYMid meet" style={{ height }} aria-hidden>
      <defs>
        <pattern id="route-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" fill="none" className="route-svg__grid" />
        </pattern>
      </defs>
      <rect width="400" height="220" fill="url(#route-grid)" />
      <path d={path.d} className="route-svg__casing" />
      <path d={path.d} className="route-svg__line" />
      <circle cx={path.start[0]} cy={path.start[1]} r="5" className="route-svg__start" />
      <circle cx={path.end[0]} cy={path.end[1]} r="5" className="route-svg__end" />
    </svg>
  );
});
