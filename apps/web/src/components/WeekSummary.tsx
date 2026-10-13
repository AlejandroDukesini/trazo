import { formatDistance, formatDuration, formatElevation, type GoalMetric } from '@trazo/core';
import { useQuery } from '@tanstack/react-query';
import { Target } from 'lucide-react';
import { Link } from 'react-router';
import { useUnits } from '../app/hooks';
import { api } from '../data/api';
import { Progress, Stat } from '../ui/primitives';
import { useLocalActivitiesSince } from './hooks';

export interface GoalDTO {
  id: string;
  period: 'week' | 'month' | 'year';
  metric: GoalMetric;
  sport: string | null;
  target: number;
  value: number;
  progress: number;
  periodStart: string;
  periodEnd: string;
}

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function useGoals() {
  return useQuery({ queryKey: ['goals'], queryFn: () => api<GoalDTO[]>(`/goals?tz=${encodeURIComponent(tz())}`) });
}

export function formatGoalValue(metric: GoalMetric, v: number, units: 'metric' | 'imperial') {
  if (metric === 'distance') return formatDistance(v, units, 1);
  if (metric === 'duration') return formatDuration(v, { compact: true });
  if (metric === 'elevation') return formatElevation(v, units);
  return `${Math.round(v)} act.`;
}

export const PERIOD_LABEL = { week: 'semanal', month: 'mensual', year: 'anual' } as const;
export const METRIC_LABEL: Record<GoalMetric, string> = { distance: 'Distancia', duration: 'Tiempo', elevation: 'Desnivel', count: 'Actividades' };

/** Resumen de la semana desde datos locales: funciona sin conexión. */
export function WeekSummary() {
  const units = useUnits();
  const acts = useLocalActivitiesSince('week');
  const goals = useGoals();
  const total = acts.reduce((a, x) => ({ d: a.d + x.distanceM, t: a.t + x.movingS, e: a.e + (x.elevGainM ?? 0) }), { d: 0, t: 0, e: 0 });
  return (
    <section className="card card--pad stack week-card" aria-labelledby="week-title">
      <div className="row between">
        <h2 id="week-title" className="section-title">Esta semana</h2>
        <Link className="link small" to="/progreso">Ver progreso</Link>
      </div>
      <div className="stats-row">
        <Stat label="Distancia" value={formatDistance(total.d, units, 1)} />
        <Stat label="Tiempo" value={formatDuration(total.t, { compact: true })} />
        <Stat label="Actividades" value={acts.length} />
      </div>
      {goals.data?.length ? (
        goals.data.slice(0, 3).map((g) => (
          <div key={g.id} className="stack" style={{ ['--gap' as string]: '6px' }}>
            <div className="row between small">
              <span className="row" style={{ ['--gap' as string]: '6px' }}><Target width={15} height={15} aria-hidden /> {METRIC_LABEL[g.metric]} {PERIOD_LABEL[g.period]}</span>
              <span className="num muted">{formatGoalValue(g.metric, g.value, units)} / {formatGoalValue(g.metric, g.target, units)}</span>
            </div>
            <Progress value={g.progress} label={`Progreso del objetivo ${METRIC_LABEL[g.metric].toLowerCase()}`} />
          </div>
        ))
      ) : (
        <Link to="/progreso#objetivos" className="link small">Define un objetivo semanal</Link>
      )}
      {total.e > 0 && <p className="xs subtle">Desnivel acumulado: {formatElevation(total.e, units)}</p>}
    </section>
  );
}
