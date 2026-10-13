import { chartSeries, distanceValue, formatDistance, formatDuration, formatElevation, formatPace, formatSportSpeed, formatSpeed, getSport } from '@trazo/core';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useDocumentTitle, useUnits } from '../../app/hooks';
import { LineChart } from '../../components/Charts';
import { formatDate } from '../../components/format';
import { userDb } from '../../data/db';
import type { ActivityDTO } from '../../data/types';
import { Button, Skeleton } from '../../ui/primitives';

interface Series { x: number[]; speed: Array<number | null>; ele: Array<number | null>; hr: Array<number | null> }

export default function ComparePage() {
  useDocumentTitle('Comparar actividades');
  const [params] = useSearchParams();
  const a = params.get('a'), b = params.get('b');
  const units = useUnits();
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ['compare', a, b],
    enabled: !!a && !!b,
    queryFn: async (): Promise<{ items: Array<{ activity: ActivityDTO; series: Series | null }> }> => {
      const db = userDb();
      const ids = [a!, b!];
      const items = await Promise.all(ids.map(async (id) => {
        const activity = await db.activities.get(id);
        if (!activity) throw new Error('Una de las actividades ya no existe.');
        const stored = activity.hasStream ? await db.streams.get(id) : undefined;
        const series = stored ? (() => { const c = chartSeries(stored.stream); return { x: c.x, speed: c.speed, ele: c.ele, hr: c.hr }; })() : null;
        return { activity, series };
      }));
      return { items };
    },
  });
  const xFormat = useCallback((v: number) => `${distanceValue(v, units).toFixed(1)}`, [units]);
  const rows = q.data?.items ?? [];
  const pace = rows[0] ? getSport(rows[0].activity.sport).display === 'pace' : true;
  const unit = units === 'imperial' ? 1609.344 : 1000;
  const charts = useMemo(() => rows.map((r, i) => r.series && {
    key: r.activity.id,
    title: `${i === 0 ? 'A' : 'B'} · ${r.activity.name}`,
    s: pace
      ? { label: 'Ritmo', values: r.series.speed.map((v) => (v && v > 0.3 ? unit / v : null)), colorVar: i === 0 ? '--accent' : '--data-power', format: (v: number) => formatPace(unit / v, units), invert: true }
      : { label: 'Velocidad', values: r.series.speed, colorVar: i === 0 ? '--accent' : '--data-power', format: (v: number) => formatSpeed(v, units) },
    x: r.series.x,
  }), [rows, pace, unit, units]);

  return (
    <div className="page page--wide stack">
      <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => navigate(-1)} style={{ alignSelf: 'flex-start' }}>Volver</Button>
      <h1>Comparar actividades</h1>
      {q.isPending ? (
        <Skeleton h={300} r={18} />
      ) : q.isError ? (
        <p className="muted">{(q.error as Error).message}</p>
      ) : (
        <>
          <div className="card table-wrap">
            <table className="table">
              <thead><tr><th /><th>A</th><th>B</th></tr></thead>
              <tbody>
                <tr><td>Actividad</td>{rows.map((r) => <td key={r.activity.id}><Link className="link" to={`/actividad/${r.activity.id}`}>{r.activity.name}</Link><div className="xs subtle">{formatDate(r.activity.startedAt)}</div></td>)}</tr>
                <tr><td>Distancia</td>{rows.map((r) => <td key={r.activity.id}>{formatDistance(r.activity.distanceM, units)}</td>)}</tr>
                <tr><td>Tiempo</td>{rows.map((r) => <td key={r.activity.id}>{formatDuration(r.activity.movingS)}</td>)}</tr>
                <tr><td>{pace ? 'Ritmo' : 'Velocidad'}</td>{rows.map((r) => <td key={r.activity.id}>{formatSportSpeed(r.activity.sport, r.activity.avgSpeed, units)}</td>)}</tr>
                <tr><td>Desnivel</td>{rows.map((r) => <td key={r.activity.id}>{formatElevation(r.activity.elevGainM, units)}</td>)}</tr>
                <tr><td>FC media</td>{rows.map((r) => <td key={r.activity.id}>{r.activity.avgHr ?? '–'}</td>)}</tr>
              </tbody>
            </table>
          </div>
          <div className="card card--pad charts">
            {charts.map((c) => c && <LineChart key={c.key} x={c.x} series={c.s} xFormat={xFormat} syncKey="compare" title={c.title} />)}
          </div>
        </>
      )}
    </div>
  );
}
