import { SPORTS, SPORT_KEYS, getSport, type GoalMetric } from '@trazo/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarRange, Plus, Trophy, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useDocumentTitle, useUnits } from '../../app/hooks';
import { formatDate } from '../../components/format';
import { METRIC_LABEL, formatGoalValue } from '../../components/WeekSummary';
import { api } from '../../data/api';
import { Dialog } from '../../ui/dialog';
import { Button, Chip, Empty, Field, Input, Segmented, Select, Skeleton, Textarea } from '../../ui/primitives';
import { useToast } from '../../ui/toast';

export interface ChallengeSummary { id: string; title: string; description: string; sport: string | null; metric: GoalMetric; target: number; startsAt: string; endsAt: string; clubId: string | null; clubName: string | null; joined: boolean; participants: number }

const toDateInput = (d: Date) => d.toISOString().slice(0, 10);

export function NewChallengeDialog({ clubId, open, onClose }: { clubId?: string; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const units = useUnits();
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const [f, setF] = useState({ title: '', description: '', sport: '', metric: 'distance' as GoalMetric, target: '100', start: toDateInput(now), end: toDateInput(end) });
  const unit = f.metric === 'distance' ? (units === 'imperial' ? 'mi' : 'km') : f.metric === 'duration' ? 'horas' : f.metric === 'elevation' ? 'm' : 'actividades';
  const m = useMutation({
    mutationFn: () => {
      const n = Number(f.target);
      const target = f.metric === 'distance' ? n * (units === 'imperial' ? 1609.344 : 1000) : f.metric === 'duration' ? n * 3600 : n;
      return api<{ id: string }>('/challenges', {
        method: 'POST',
        body: { title: f.title, description: f.description, sport: f.sport || null, metric: f.metric, target, startsAt: new Date(`${f.start}T00:00:00`).toISOString(), endsAt: new Date(`${f.end}T23:59:59`).toISOString(), clubId: clubId ?? null },
      });
    },
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['challenges'] }); onClose(); navigate(`/retos/${r.id}`); },
    onError: toast.error,
  });
  return (
    <Dialog open={open} onClose={onClose} title={clubId ? 'Nuevo reto del club' : 'Nuevo reto'} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} disabled={f.title.trim().length < 3} onClick={() => m.mutate()}>Crear reto</Button></>}>
      <div className="form-grid">
        <Field label="Título">{(id) => <Input id={id} value={f.title} maxLength={80} placeholder="100 km en octubre" onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="Descripción">{(id) => <Textarea id={id} value={f.description} maxLength={1000} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        <div className="form-grid form-grid--2">
          <Field label="Métrica">{(id) => <Select id={id} value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value as GoalMetric })}><option value="distance">Distancia</option><option value="duration">Tiempo</option><option value="elevation">Desnivel</option><option value="count">Nº de actividades</option></Select>}</Field>
          <Field label={`Objetivo (${unit})`}>{(id) => <Input id={id} type="number" min={1} value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} />}</Field>
          <Field label="Deporte">{(id) => <Select id={id} value={f.sport} onChange={(e) => setF({ ...f, sport: e.target.value })}><option value="">Cualquiera</option>{SPORT_KEYS.map((k) => <option key={k} value={k}>{SPORTS[k]!.label}</option>)}</Select>}</Field>
          <span />
          <Field label="Desde">{(id) => <Input id={id} type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />}</Field>
          <Field label="Hasta">{(id) => <Input id={id} type="date" value={f.end} min={f.start} onChange={(e) => setF({ ...f, end: e.target.value })} />}</Field>
        </div>
      </div>
    </Dialog>
  );
}

export function ChallengeRow({ c }: { c: ChallengeSummary }) {
  const units = useUnits();
  return (
    <Link to={`/retos/${c.id}`} className="list-item">
      <span className="list-item__icon"><Trophy aria-hidden /></span>
      <span className="grow">
        <strong className="small">{c.title}</strong>
        <div className="xs subtle">{METRIC_LABEL[c.metric]}: {formatGoalValue(c.metric, c.target, units)}{c.sport ? ` · ${getSport(c.sport).label}` : ''} · {formatDate(c.startsAt)} – {formatDate(c.endsAt)}{c.clubName ? ` · ${c.clubName}` : ''}</div>
      </span>
      <span className="xs subtle row" style={{ ['--gap' as string]: '4px' }}><Users width={14} /> {c.participants}</span>
      {c.joined && <Chip tone="accent">Participas</Chip>}
    </Link>
  );
}

export default function ChallengesPage() {
  useDocumentTitle('Retos');
  const [scope, setScope] = useState<'active' | 'joined' | 'past'>('active');
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['challenges', scope], queryFn: () => api<ChallengeSummary[]>(`/challenges?scope=${scope}`) });
  return (
    <div className="page page--narrow">
      <div className="page__head">
        <div><h1>Retos</h1><p>Objetivos compartidos con tu gente o tus clubes.</p></div>
        <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Crear reto</Button>
      </div>
      <Segmented label="Filtro" value={scope} onChange={setScope} options={[{ value: 'active', label: 'Activos' }, { value: 'joined', label: 'Mis retos' }, { value: 'past', label: 'Finalizados' }]} />
      <div className="card" style={{ marginTop: 16 }}>
        {q.isPending && <div className="card__body"><Skeleton h={56} /></div>}
        {q.data?.length === 0 && <Empty icon={CalendarRange} title="No hay retos aquí">Crea uno y comparte el enlace, o únete a los retos de tus clubes.</Empty>}
        <div className="list">{q.data?.map((c) => <ChallengeRow key={c.id} c={c} />)}</div>
      </div>
      <NewChallengeDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
