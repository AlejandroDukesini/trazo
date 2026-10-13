import {
  SPORTS, SPORT_KEYS, formatDistance, formatDuration, formatElevation, getSport, periodStart, riegel, summarize, type GoalMetric, type GoalPeriod,
} from '@trazo/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDownRight, ArrowUpRight, Medal, Plus, Target, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useDocumentTitle, useUnits } from '../../app/hooks';
import { BarChart } from '../../components/Charts';
import { formatDate, formatShortDate } from '../../components/format';
import { METRIC_LABEL, PERIOD_LABEL, formatGoalValue, useGoals } from '../../components/WeekSummary';
import { userDb } from '../../data/db';
import { addGoal, deleteGoal } from '../../data/goals';
import { Dialog, useConfirm } from '../../ui/dialog';
import { Button, Chip, Empty, Field, Input, Progress, Segmented, Select, Skeleton, Stat } from '../../ui/primitives';
import { useToast } from '../../ui/toast';

type Metric = 'distanceM' | 'movingS' | 'elevGainM' | 'count';

function Summary() {
  const units = useUnits();
  const [period, setPeriod] = useState<GoalPeriod>('week');
  const [metric, setMetric] = useState<Metric>('distanceM');
  const [sport, setSport] = useState('');
  const all = useLiveQuery(() => userDb().activities.toArray(), []);

  const buckets = useMemo(() => {
    if (!all) return [];
    const s = summarize(all, period, sport || null);
    const count = period === 'year' ? 5 : 12;
    const out = [];
    let cursor = periodStart(period);
    for (let i = 0; i < count; i++) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
      const found = s.find((b) => b.key === key);
      out.unshift({ key, start: new Date(cursor), count: found?.count ?? 0, distanceM: found?.distanceM ?? 0, movingS: found?.movingS ?? 0, elevGainM: found?.elevGainM ?? 0 });
      const prev = new Date(cursor);
      if (period === 'week') prev.setDate(prev.getDate() - 7);
      else if (period === 'month') prev.setMonth(prev.getMonth() - 1);
      else prev.setFullYear(prev.getFullYear() - 1);
      cursor = prev;
    }
    return out;
  }, [all, period, sport]);

  const fmt = (v: number) => metric === 'distanceM' ? formatDistance(v, units, 1) : metric === 'movingS' ? formatDuration(v, { compact: true }) : metric === 'elevGainM' ? formatElevation(v, units) : `${v} act.`;
  const label = (d: Date) => period === 'week' ? `Sem. ${formatShortDate(d)}` : period === 'month' ? d.toLocaleDateString('es', { month: 'short', year: '2-digit' }) : String(d.getFullYear());
  const cur = buckets.at(-1), prev = buckets.at(-2);
  const total = buckets.reduce((acc, b) => ({ d: acc.d + b.distanceM, t: acc.t + b.movingS, e: acc.e + b.elevGainM, c: acc.c + b.count }), { d: 0, t: 0, e: 0, c: 0 });

  return (
    <section className="card card--pad stack" aria-labelledby="sum-title">
      <div className="row between wrap">
        <h2 id="sum-title">Resumen</h2>
        <div className="row wrap">
          <Select aria-label="Deporte" value={sport} onChange={(e) => setSport(e.target.value)} style={{ width: 'auto' }}>
            <option value="">Todos</option>
            {SPORT_KEYS.map((k) => <option key={k} value={k}>{SPORTS[k]!.label}</option>)}
          </Select>
          <Segmented label="Periodo" value={period} onChange={setPeriod} options={[{ value: 'week', label: 'Semanas' }, { value: 'month', label: 'Meses' }, { value: 'year', label: 'Años' }]} />
        </div>
      </div>
      <Segmented label="Métrica" value={metric} onChange={setMetric} options={[{ value: 'distanceM', label: 'Distancia' }, { value: 'movingS', label: 'Tiempo' }, { value: 'elevGainM', label: 'Desnivel' }, { value: 'count', label: 'Actividades' }]} />
      {!all ? <Skeleton h={200} /> : (
        <BarChart label="Resumen por periodo" data={buckets.map((b) => ({ key: b.key, label: label(b.start), short: period === 'week' ? formatShortDate(b.start) : period === 'month' ? b.start.toLocaleDateString('es', { month: 'short' }) : String(b.start.getFullYear()), value: metric === 'count' ? b.count : b[metric] }))} format={fmt} height={180} />
      )}
      {cur && prev && (
        <div className="stats-row">
          <Stat label={period === 'week' ? 'Esta semana' : period === 'month' ? 'Este mes' : 'Este año'} value={fmt(metric === 'count' ? cur.count : cur[metric])} note={<Delta now={metric === 'count' ? cur.count : cur[metric]} before={metric === 'count' ? prev.count : prev[metric]} />} />
          <Stat label="Total del periodo mostrado" value={formatDistance(total.d, units, 0)} note={`${total.c} actividades · ${formatDuration(total.t, { compact: true })}`} />
        </div>
      )}
    </section>
  );
}

function Delta({ now, before }: { now: number; before: number }) {
  if (!before) return <span>—</span>;
  const pct = ((now - before) / before) * 100;
  const up = pct >= 0;
  return <span className="row" style={{ ['--gap' as string]: '2px', color: up ? 'var(--success)' : 'var(--text-3)' }}>{up ? <ArrowUpRight width={14} /> : <ArrowDownRight width={14} />}{Math.abs(pct).toFixed(0)} % vs. anterior</span>;
}

type Agg = { count: number; distanceM: number; movingS: number; elevGainM: number };

function aggregate(acts: Array<{ startedAt: string; distanceM: number; movingS: number; elevGainM: number | null }>, from: number, to: number): Agg {
  const out: Agg = { count: 0, distanceM: 0, movingS: 0, elevGainM: 0 };
  for (const a of acts) {
    const ms = Date.parse(a.startedAt);
    if (ms < from || ms >= to) continue;
    out.count++; out.distanceM += a.distanceM; out.movingS += a.movingS; out.elevGainM += a.elevGainM ?? 0;
  }
  return out;
}

function PeriodCompare() {
  const units = useUnits();
  const [period, setPeriod] = useState<GoalPeriod>('month');
  const all = useLiveQuery(() => userDb().activities.toArray(), []);
  const data = useMemo(() => {
    if (!all) return null;
    const now = Date.now();
    const curStart = periodStart(period);
    const elapsed = now - curStart.getTime();
    const prevStart = periodStart(period, new Date(curStart.getTime() - 1));
    const lastYearStart = new Date(curStart); lastYearStart.setFullYear(lastYearStart.getFullYear() - 1);
    return {
      current: aggregate(all, curStart.getTime(), now),
      previous: aggregate(all, prevStart.getTime(), prevStart.getTime() + elapsed),
      lastYear: aggregate(all, lastYearStart.getTime(), lastYearStart.getTime() + elapsed),
    };
  }, [all, period]);
  const cols: Array<readonly [string, Agg]> = data ? [['Actual', data.current], ['Anterior', data.previous], ['Hace un año', data.lastYear]] : [];
  return (
    <section className="card card--pad stack">
      <div className="row between wrap"><h2>Comparativa entre periodos</h2><Segmented label="Periodo" value={period} onChange={setPeriod} options={[{ value: 'week', label: 'Semana' }, { value: 'month', label: 'Mes' }, { value: 'year', label: 'Año' }]} /></div>
      <p className="xs subtle">Cada periodo se compara hasta el mismo punto relativo (p. ej. los primeros 12 días del mes).</p>
      {!data ? <Skeleton h={120} /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th /> {cols.map(([l]) => <th key={l} className="right">{l}</th>)}</tr></thead>
            <tbody>
              <tr><td>Actividades</td>{cols.map(([l, v]) => <td key={l} className="right">{v.count}</td>)}</tr>
              <tr><td>Distancia</td>{cols.map(([l, v]) => <td key={l} className="right">{formatDistance(v.distanceM, units, 1)}</td>)}</tr>
              <tr><td>Tiempo</td>{cols.map(([l, v]) => <td key={l} className="right">{formatDuration(v.movingS, { compact: true })}</td>)}</tr>
              <tr><td>Desnivel</td>{cols.map(([l, v]) => <td key={l} className="right">{formatElevation(v.elevGainM, units)}</td>)}</tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Goals() {
  const units = useUnits();
  const goals = useGoals();
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ period: 'week' as GoalPeriod, metric: 'distance' as GoalMetric, sport: '', target: '20' });
  const create = async () => {
    setSaving(true);
    try {
      const n = Number(form.target);
      const target = form.metric === 'distance' ? n * (units === 'imperial' ? 1609.344 : 1000) : form.metric === 'duration' ? n * 3600 : n;
      await addGoal({ period: form.period, metric: form.metric, sport: form.sport || null, target });
      setOpen(false);
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };
  const unitLabel = form.metric === 'distance' ? (units === 'imperial' ? 'mi' : 'km') : form.metric === 'duration' ? 'horas' : form.metric === 'elevation' ? 'm' : 'actividades';
  return (
    <section className="card card--pad stack" id="objetivos">
      <div className="row between"><h2>Objetivos</h2><Button size="sm" icon={Plus} onClick={() => setOpen(true)}>Nuevo objetivo</Button></div>
      {!goals.data && <Skeleton h={60} />}
      {goals.data?.length === 0 && <Empty icon={Target} title="Sin objetivos">Marca un objetivo de distancia, tiempo, desnivel o número de actividades.</Empty>}
      {goals.data?.map((g) => (
        <div key={g.id} className="stack" style={{ ['--gap' as string]: '6px' }}>
          <div className="row between">
            <strong className="small">{METRIC_LABEL[g.metric]} {PERIOD_LABEL[g.period]}{g.sport ? ` · ${getSport(g.sport).label}` : ''}</strong>
            <div className="row" style={{ ['--gap' as string]: '4px' }}>
              <span className="small num muted">{formatGoalValue(g.metric, g.value, units)} / {formatGoalValue(g.metric, g.target, units)}</span>
              <Button size="sm" variant="ghost" icon={Trash2} aria-label="Eliminar objetivo" onClick={async () => { if (await confirm({ title: 'Eliminar objetivo', message: 'Dejará de mostrarse tu progreso para este objetivo.', confirmLabel: 'Eliminar', danger: true })) void deleteGoal(g.id); }} />
            </div>
          </div>
          <Progress value={g.progress} label={`Progreso ${METRIC_LABEL[g.metric]}`} />
          {g.progress >= 1 && <Chip tone="accent">¡Conseguido!</Chip>}
        </div>
      ))}
      <Dialog open={open} onClose={() => setOpen(false)} title="Nuevo objetivo" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button variant="primary" loading={saving} onClick={create}>Crear</Button></>}>
        <div className="form-grid form-grid--2">
          <Field label="Periodo">{(id) => <Select id={id} value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value as GoalPeriod })}><option value="week">Semanal</option><option value="month">Mensual</option><option value="year">Anual</option></Select>}</Field>
          <Field label="Métrica">{(id) => <Select id={id} value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value as GoalMetric })}><option value="distance">Distancia</option><option value="duration">Tiempo</option><option value="elevation">Desnivel</option><option value="count">Nº de actividades</option></Select>}</Field>
          <Field label="Deporte">{(id) => <Select id={id} value={form.sport} onChange={(e) => setForm({ ...form, sport: e.target.value })}><option value="">Todos</option>{SPORT_KEYS.map((k) => <option key={k} value={k}>{SPORTS[k]!.label}</option>)}</Select>}</Field>
          <Field label={`Objetivo (${unitLabel})`}>{(id) => <Input id={id} type="number" min={0.1} step="0.1" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} />}</Field>
        </div>
      </Dialog>
    </section>
  );
}

function Records() {
  const all = useLiveQuery(() => userDb().activities.toArray(), []);
  const records = useMemo(() => {
    const best = new Map<string, { label: string; distanceM: number; elapsedS: number; id: string; name: string; date: string; group: string }>();
    for (const a of all ?? []) {
      if (a.source === 'manual') continue;
      const group = getSport(a.sport).group;
      for (const e of a.stats.bestEfforts ?? []) {
        const k = `${group}:${e.distanceM}`;
        const cur = best.get(k);
        if (!cur || e.elapsedS < cur.elapsedS) best.set(k, { label: e.label, distanceM: e.distanceM, elapsedS: e.elapsedS, id: a.id, name: a.name, date: a.startedAt, group });
      }
    }
    return [...best.values()].sort((a, b) => a.group.localeCompare(b.group) || a.distanceM - b.distanceM);
  }, [all]);
  const run5k = records.find((r) => r.group === 'foot' && r.distanceM === 5000) ?? records.find((r) => r.group === 'foot' && r.distanceM === 10000);
  return (
    <section className="card stack" style={{ ['--gap' as string]: '0' }}>
      <div className="card__head"><h2>Récords personales</h2></div>
      {!records.length ? <div className="card__body"><Empty icon={Medal} title="Aún sin récords">Se calculan automáticamente a partir de tus actividades con GPS.</Empty></div> : (
        <div className="list">
          {records.map((r) => (
            <Link key={`${r.group}${r.distanceM}`} to={`/actividad/${r.id}`} className="list-item">
              <span className="list-item__icon"><Medal aria-hidden /></span>
              <span className="grow"><strong className="small">{r.label}</strong> <span className="xs subtle">{r.group === 'ride' ? 'Ciclismo' : 'A pie'}</span><div className="xs subtle ellipsis">{r.name} · {formatDate(r.date)}</div></span>
              <strong className="num">{formatDuration(r.elapsedS)}</strong>
            </Link>
          ))}
        </div>
      )}
      {run5k && (
        <div className="card__body">
          <p className="small"><strong>Estimación</strong> (fórmula de Riegel a partir de tu mejor {run5k.label}): 10 km en <span className="num">{formatDuration(riegel(run5k.elapsedS, run5k.distanceM, 10_000))}</span>, media maratón en <span className="num">{formatDuration(riegel(run5k.elapsedS, run5k.distanceM, 21_097.5))}</span>.</p>
          <p className="xs subtle">Es una aproximación matemática; depende del entrenamiento específico para cada distancia.</p>
        </div>
      )}
    </section>
  );
}

export default function ProgressPage() {
  useDocumentTitle('Progreso');
  return (
    <div className="page page--wide">
      <div className="page__head"><div><h1>Progreso</h1><p>Tus números, tus objetivos y tus mejores marcas.</p></div></div>
      <div className="grid-2">
        <div className="stack">
          <Summary />
          <PeriodCompare />
        </div>
        <div className="stack">
          <Goals />
          <Records />
        </div>
      </div>
    </div>
  );
}
