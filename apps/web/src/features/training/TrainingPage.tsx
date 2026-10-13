import { getSport, type FitnessPoint } from '@trazo/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, CalendarCheck, CheckCircle2, Circle, Info, X } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../app/hooks';
import { LineChart, type LineSeries } from '../../components/Charts';
import { formatShortDate } from '../../components/format';
import { api } from '../../data/api';
import { useSession } from '../../data/session';
import { Dialog, useConfirm } from '../../ui/dialog';
import { Button, Chip, Field, Input, Notice, Segmented, Skeleton, Stat } from '../../ui/primitives';
import { useToast } from '../../ui/toast';
import { PlusLock } from '../settings/PlusLock';

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

function LoadChart() {
  const { can } = useSession();
  const [days, setDays] = useState<'90' | '180' | '365'>('90');
  const q = useQuery({
    queryKey: ['training-load', days],
    enabled: can('training.load'),
    queryFn: () => api<{ series: FitnessPoint[]; activitiesWithoutLoad: number; method: string }>(`/training/load?days=${days}&tz=${encodeURIComponent(tz)}`),
  });
  const x = useMemo(() => q.data?.series.map((_, i) => i) ?? [], [q.data]);
  const series = useMemo<LineSeries[]>(() => q.data ? [
    { label: 'Forma', values: q.data.series.map((p) => p.ctl), colorVar: '--accent', format: (v) => v.toFixed(0) },
    { label: 'Fatiga', values: q.data.series.map((p) => p.atl), colorVar: '--data-hr', format: (v) => v.toFixed(0) },
  ] : [], [q.data]);
  const balance = useMemo<LineSeries[]>(() => q.data ? [{ label: 'Balance', values: q.data.series.map((p) => p.tsb), colorVar: '--data-cadence', fill: true, format: (v) => v.toFixed(0) }] : [], [q.data]);
  const xFormat = useCallback((i: number) => (q.data?.series[Math.round(i)] ? formatShortDate(q.data.series[Math.round(i)]!.date) : ''), [q.data]);
  if (!can('training.load')) return <PlusLock feature="training.load">Sigue tu forma (carga crónica), fatiga (carga aguda) y balance a partir de la frecuencia cardíaca o del esfuerzo percibido.</PlusLock>;
  const last = q.data?.series.at(-1);
  return (
    <section className="card card--pad stack">
      <div className="row between wrap">
        <h2>Carga, forma y fatiga</h2>
        <Segmented label="Rango" value={days} onChange={setDays} options={[{ value: '90', label: '3 meses' }, { value: '180', label: '6 meses' }, { value: '365', label: '1 año' }]} />
      </div>
      {q.isPending ? <Skeleton h={240} /> : q.isError ? <p className="muted">{(q.error as Error).message}</p> : (
        <>
          <div className="stats-row">
            <Stat label="Forma (CTL)" value={last?.ctl.toFixed(0) ?? '–'} />
            <Stat label="Fatiga (ATL)" value={last?.atl.toFixed(0) ?? '–'} />
            <Stat label="Balance (TSB)" value={last?.tsb.toFixed(0) ?? '–'} note={last ? (last.tsb < -20 ? 'Carga alta' : last.tsb > 10 ? 'Descansado' : 'Equilibrado') : undefined} />
          </div>
          <LineChart x={x} series={series} xFormat={xFormat} title="Forma y fatiga" syncKey="load" height={200} />
          <LineChart x={x} series={balance} xFormat={xFormat} title="Balance" syncKey="load" height={120} />
          <Notice icon={Info}>
            {q.data.method} Indicadores orientativos para deporte recreativo; no son un diagnóstico médico.
            {q.data.activitiesWithoutLoad > 0 && ` ${q.data.activitiesWithoutLoad} actividad(es) del periodo no tienen datos para calcular carga (añade el esfuerzo percibido o tu FC máxima en el perfil).`}
          </Notice>
        </>
      )}
    </section>
  );
}

interface PlanTemplate { key: string; title: string; sport: string; level: string; weeks: number; summary: string }
interface CurrentPlan { key: string; title: string; sport: string; startDate: string; disclaimer: string; weeks: Array<{ week: number; sessions: Array<{ day: number; kind: string; title: string; minutes: number; detail: string; date: string; done: boolean }> }> }

function nextMonday() {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

function Plans() {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [choose, setChoose] = useState<PlanTemplate | null>(null);
  const [start, setStart] = useState(nextMonday());
  const templates = useQuery({ queryKey: ['plans'], queryFn: () => api<PlanTemplate[]>('/training/plans') });
  const current = useQuery({ queryKey: ['plan-current'], queryFn: () => api<CurrentPlan | null>(`/training/plans/current?tz=${encodeURIComponent(tz)}`) });
  const enroll = useMutation({
    mutationFn: () => api('/training/plans/enroll', { method: 'POST', body: { key: choose!.key, startDate: start } }),
    onSuccess: () => { setChoose(null); void qc.invalidateQueries({ queryKey: ['plan-current'] }); toast.show('Plan activado', { tone: 'success' }); },
    onError: toast.error,
  });
  const leave = useMutation({ mutationFn: () => api('/training/plans/current', { method: 'DELETE' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['plan-current'] }) });
  const today = new Date().toISOString().slice(0, 10);
  const plan = current.data;
  const thisWeek = plan?.weeks.find((w) => w.sessions.some((s) => s.date >= today)) ?? plan?.weeks.at(-1);

  return (
    <section className="stack">
      {plan && thisWeek && (
        <div className="card card--pad stack">
          <div className="row between wrap">
            <div><h2>{plan.title}</h2><p className="small muted">Semana {thisWeek.week} de {plan.weeks.length} · {getSport(plan.sport).label}</p></div>
            <Button size="sm" variant="ghost" icon={X} onClick={async () => { if (await confirm({ title: 'Abandonar plan', message: 'Dejarás de ver las sesiones programadas.', confirmLabel: 'Abandonar', danger: true })) leave.mutate(); }}>Abandonar</Button>
          </div>
          <div className="list">
            {thisWeek.sessions.map((s) => (
              <div key={s.date + s.title} className="list-item" style={{ alignItems: 'flex-start' }}>
                <span className="list-item__icon" style={s.done ? { background: 'var(--accent-soft)', color: 'var(--accent-strong)' } : undefined}>{s.done ? <CheckCircle2 aria-label="Hecha" /> : <Circle aria-label="Pendiente" />}</span>
                <div className="grow">
                  <div className="row between"><strong className="small">{s.title}</strong><span className="xs subtle">{new Date(s.date + 'T12:00:00').toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' })}</span></div>
                  <p className="xs muted">{s.minutes} min · {s.detail}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="xs subtle">{plan.disclaimer} Una sesión se marca como hecha si registras una actividad de ese deporte ese día.</p>
        </div>
      )}
      <div className="card card--pad stack">
        <h2>Planes de entrenamiento</h2>
        {!can('training.plans') && <PlusLock feature="training.plans" compact />}
        {templates.isPending && <Skeleton h={100} />}
        <div className="grid-3">
          {templates.data?.map((t) => (
            <div key={t.key} className="card card--flat card--pad stack" style={{ ['--gap' as string]: '8px' }}>
              <div className="row between"><strong>{t.title}</strong><Chip>{t.weeks} semanas</Chip></div>
              <span className="xs subtle">{getSport(t.sport).label} · {t.level}</span>
              <p className="small muted">{t.summary}</p>
              <Button size="sm" icon={CalendarCheck} disabled={!can('training.plans')} onClick={() => setChoose(t)}>Empezar</Button>
            </div>
          ))}
        </div>
      </div>
      <Dialog open={!!choose} onClose={() => setChoose(null)} title={choose?.title ?? ''} footer={<><Button variant="ghost" onClick={() => setChoose(null)}>Cancelar</Button><Button variant="primary" loading={enroll.isPending} onClick={() => enroll.mutate()}>Activar plan</Button></>}>
        <div className="stack">
          <p className="small muted">{choose?.summary}</p>
          <Field label="Fecha de inicio">{(id) => <Input id={id} type="date" value={start} min={today} onChange={(e) => setStart(e.target.value)} />}</Field>
          {plan && <Notice icon={Info} tone="warning">Sustituirá a tu plan actual.</Notice>}
        </div>
      </Dialog>
    </section>
  );
}

export default function TrainingPage() {
  useDocumentTitle('Entrenamiento');
  return (
    <div className="page page--wide">
      <div className="page__head"><div><h1>Entrenamiento</h1><p>Carga, forma y planes para avanzar con cabeza.</p></div><Activity aria-hidden className="subtle" /></div>
      <div className="stack" style={{ ['--gap' as string]: '20px' }}>
        <LoadChart />
        <Plans />
      </div>
    </div>
  );
}
