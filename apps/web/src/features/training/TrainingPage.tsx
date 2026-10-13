import { TRAINING_PLANS, fitnessSeries, getSport, planWeek } from '@trazo/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { Activity, CalendarCheck, CheckCircle2, Circle, Info, X } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../app/hooks';
import { LineChart, type LineSeries } from '../../components/Charts';
import { formatShortDate } from '../../components/format';
import { userDb } from '../../data/db';
import { enrollPlan, getEnrollment, leavePlan } from '../../data/training-local';
import { Dialog, useConfirm } from '../../ui/dialog';
import { Button, Chip, Field, Input, Notice, Segmented, Skeleton, Stat } from '../../ui/primitives';
import { useToast } from '../../ui/toast';

const DAY = 86_400_000;

function LoadChart() {
  const [days, setDays] = useState<'90' | '180' | '365'>('90');
  const data = useLiveQuery(async () => {
    const acts = await userDb().activities.toArray();
    const to = Date.now();
    const from = to - Number(days) * DAY;
    const loads = acts
      .filter((a) => a.trainingLoad != null)
      .map((a) => ({ date: a.startedAt.slice(0, 10), load: a.trainingLoad! }));
    // La serie necesita arrancar antes para estabilizar las medias exponenciales.
    const series = fitnessSeries(loads, from - 42 * DAY, to).filter((p) => Date.parse(p.date) >= from);
    const withoutLoad = acts.filter((a) => a.trainingLoad == null && Date.parse(a.startedAt) >= from).length;
    return { series, withoutLoad };
  }, [days]);
  const x = useMemo(() => data?.series.map((_, i) => i) ?? [], [data]);
  const series = useMemo<LineSeries[]>(() => data ? [
    { label: 'Forma', values: data.series.map((p) => p.ctl), colorVar: '--accent', format: (v) => v.toFixed(0) },
    { label: 'Fatiga', values: data.series.map((p) => p.atl), colorVar: '--data-hr', format: (v) => v.toFixed(0) },
  ] : [], [data]);
  const balance = useMemo<LineSeries[]>(() => data ? [{ label: 'Balance', values: data.series.map((p) => p.tsb), colorVar: '--data-cadence', fill: true, format: (v) => v.toFixed(0) }] : [], [data]);
  const xFormat = useCallback((i: number) => (data?.series[Math.round(i)] ? formatShortDate(new Date(data.series[Math.round(i)]!.date + 'T12:00:00')) : ''), [data]);
  const last = data?.series.at(-1);
  return (
    <section className="card card--pad stack">
      <div className="row between wrap">
        <h2>Carga, forma y fatiga</h2>
        <Segmented label="Rango" value={days} onChange={setDays} options={[{ value: '90', label: '3 meses' }, { value: '180', label: '6 meses' }, { value: '365', label: '1 año' }]} />
      </div>
      {!data ? <Skeleton h={240} /> : (
        <>
          <div className="stats-row">
            <Stat label="Forma (CTL)" value={last?.ctl.toFixed(0) ?? '–'} />
            <Stat label="Fatiga (ATL)" value={last?.atl.toFixed(0) ?? '–'} />
            <Stat label="Balance (TSB)" value={last?.tsb.toFixed(0) ?? '–'} note={last ? (last.tsb < -20 ? 'Carga alta' : last.tsb > 10 ? 'Descansado' : 'Equilibrado') : undefined} />
          </div>
          <LineChart x={x} series={series} xFormat={xFormat} title="Forma y fatiga" syncKey="load" height={200} />
          <LineChart x={x} series={balance} xFormat={xFormat} title="Balance" syncKey="load" height={120} />
          <Notice icon={Info}>
            Carga calculada a partir de la frecuencia cardíaca (TRIMP de Edwards) o del esfuerzo percibido (sRPE). Indicadores orientativos para deporte recreativo; no son un diagnóstico médico.
            {data.withoutLoad > 0 && ` ${data.withoutLoad} actividad(es) del periodo no tienen datos para calcular carga (añade el esfuerzo percibido o tu FC máxima en el perfil).`}
          </Notice>
        </>
      )}
    </section>
  );
}

function nextMonday() {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

function Plans() {
  const toast = useToast();
  const confirm = useConfirm();
  const [choose, setChoose] = useState<(typeof TRAINING_PLANS)[number] | null>(null);
  const [start, setStart] = useState(nextMonday());
  const today = new Date().toISOString().slice(0, 10);

  const plan = useLiveQuery(async () => {
    const enr = await getEnrollment();
    if (!enr) return null;
    const tpl = TRAINING_PLANS.find((t) => t.key === enr.key);
    if (!tpl) return null;
    const acts = await userDb().activities.toArray();
    const done = new Set(acts.map((a) => `${getSport(a.sport).group}:${a.startedAt.slice(0, 10)}`));
    const startDate = new Date(enr.startDate + 'T12:00:00');
    const weeks = [];
    for (let w = 1; w <= tpl.weeks; w++) {
      const sessions = planWeek(tpl, startDate, w).map((s) => {
        const date = s.date.toISOString().slice(0, 10);
        return { day: s.day, kind: s.kind, title: s.title, minutes: s.minutes, detail: s.detail, date, done: s.kind !== 'rest' && done.has(`${getSport(tpl.sport).group}:${date}`) };
      });
      weeks.push({ week: w, sessions });
    }
    return { key: tpl.key, title: tpl.title, sport: tpl.sport, weeks };
  }, []);

  const doEnroll = async () => {
    if (!choose) return;
    await enrollPlan(choose.key, start);
    setChoose(null);
    toast.show('Plan activado', { tone: 'success' });
  };

  const thisWeek = plan?.weeks.find((w) => w.sessions.some((s) => s.date >= today)) ?? plan?.weeks.at(-1);

  return (
    <section className="stack">
      {plan && thisWeek && (
        <div className="card card--pad stack">
          <div className="row between wrap">
            <div><h2>{plan.title}</h2><p className="small muted">Semana {thisWeek.week} de {plan.weeks.length} · {getSport(plan.sport).label}</p></div>
            <Button size="sm" variant="ghost" icon={X} onClick={async () => { if (await confirm({ title: 'Abandonar plan', message: 'Dejarás de ver las sesiones programadas.', confirmLabel: 'Abandonar', danger: true })) void leavePlan(); }}>Abandonar</Button>
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
          <p className="xs subtle">Plan orientativo; adáptalo a cómo te sientas. Una sesión se marca como hecha si registras una actividad de ese deporte ese día.</p>
        </div>
      )}
      <div className="card card--pad stack">
        <h2>Planes de entrenamiento</h2>
        <div className="grid-3">
          {TRAINING_PLANS.map((t) => (
            <div key={t.key} className="card card--flat card--pad stack" style={{ ['--gap' as string]: '8px' }}>
              <div className="row between"><strong>{t.title}</strong><Chip>{t.weeks} semanas</Chip></div>
              <span className="xs subtle">{getSport(t.sport).label} · {t.level}</span>
              <p className="small muted">{t.summary}</p>
              <Button size="sm" icon={CalendarCheck} onClick={() => setChoose(t)}>Empezar</Button>
            </div>
          ))}
        </div>
      </div>
      <Dialog open={!!choose} onClose={() => setChoose(null)} title={choose?.title ?? ''} footer={<><Button variant="ghost" onClick={() => setChoose(null)}>Cancelar</Button><Button variant="primary" onClick={doEnroll}>Activar plan</Button></>}>
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
