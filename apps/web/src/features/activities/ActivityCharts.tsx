import { chartSeries, distanceValue, formatDistance, formatElevation, formatPace, formatSpeed, getSport, type Stream, type Units } from '@trazo/core';
import { useCallback, useMemo, useState } from 'react';
import { LineChart, type LineSeries } from '../../components/Charts';
import { MapView } from '../../components/MapView';

/** Mapa + gráficos con cursor sincronizado (pasar por el gráfico marca el punto en el mapa). */
export function MapAndCharts({ stream, sport, units, side }: { stream: Stream; sport: string; units: Units; side: React.ReactNode }) {
  const series = useMemo(() => chartSeries(stream, 1500), [stream]);
  const [hl, setHl] = useState<number | null>(null);
  const track = useMemo(() => [{ id: 'act', lat: stream.lat, lng: stream.lng, seg: stream.seg }], [stream]);
  const highlight = hl != null ? { lat: stream.lat[hl * series.step]!, lng: stream.lng[hl * series.step]! } : null;
  const pace = getSport(sport).display === 'pace';
  const xFormat = useCallback((v: number) => `${distanceValue(v, units).toFixed(1)} ${units === 'imperial' ? 'mi' : 'km'}`, [units]);

  const charts = useMemo(() => {
    const list: Array<{ key: string; title: string; s: LineSeries }> = [];
    // El ritmo a velocidades muy bajas dispara el eje: se recorta a valores útiles.
    const speed = series.speed.map((v) => (v != null && v > 0.3 ? v : null));
    list.push({
      key: 'speed',
      title: pace ? 'Ritmo' : 'Velocidad',
      s: pace
        ? { label: 'Ritmo', values: speed.map((v) => (v ? (units === 'imperial' ? 1609.344 : 1000) / v : null)), colorVar: '--accent', format: (v) => formatPace((units === 'imperial' ? 1609.344 : 1000) / v, units), invert: true }
        : { label: 'Velocidad', values: speed, colorVar: '--accent', format: (v) => formatSpeed(v, units) },
    });
    if (series.ele.some((v) => v != null)) list.push({ key: 'ele', title: 'Elevación', s: { label: 'Elevación', values: series.ele, colorVar: '--text-3', fill: true, format: (v) => formatElevation(v, units) } });
    if (series.hr.some((v) => v != null)) list.push({ key: 'hr', title: 'Frecuencia cardíaca', s: { label: 'FC', values: series.hr, colorVar: '--data-hr', format: (v) => `${Math.round(v)} ppm` } });
    if (series.power.some((v) => v != null)) list.push({ key: 'power', title: 'Potencia', s: { label: 'Potencia', values: series.power, colorVar: '--data-power', format: (v) => `${Math.round(v)} W` } });
    if (series.cadence.some((v) => v != null)) list.push({ key: 'cad', title: 'Cadencia', s: { label: 'Cadencia', values: series.cadence, colorVar: '--data-cadence', format: (v) => `${Math.round(v)} rpm` } });
    return list;
  }, [series, pace, units]);

  return (
    <>
      <div className="detail-hero">
        <MapView tracks={track} highlight={highlight} fitKey={stream.t.length} label="Mapa de la actividad" />
        {side}
      </div>
      <section className="card card--pad charts" aria-label="Gráficos">
        {charts.map((c) => (
          <LineChart key={c.key} x={series.x} series={c.s} xFormat={xFormat} syncKey="activity" onCursor={setHl} title={c.title} right={<span className="subtle">{formatDistance(series.x.at(-1) ?? 0, units)}</span>} />
        ))}
      </section>
    </>
  );
}
