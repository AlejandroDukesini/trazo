import { getSport, type GoalMetric } from '@trazo/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Trophy } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { useDocumentTitle, useUnits } from '../../app/hooks';
import { formatDate } from '../../components/format';
import { METRIC_LABEL, formatGoalValue } from '../../components/WeekSummary';
import { api, mediaUrl } from '../../data/api';
import type { UserCard } from '../../data/types';
import { useSession } from '../../data/session';
import { Avatar, Button, Empty, Progress, Skeleton, Stat } from '../../ui/primitives';
import { useToast } from '../../ui/toast';

interface Challenge {
  id: string; title: string; description: string; sport: string | null; metric: GoalMetric; target: number; startsAt: string; endsAt: string; clubId: string | null; joined: boolean;
  leaderboard: Array<{ rank: number; user: UserCard; value: number; completed: boolean }>;
}

export default function ChallengePage() {
  const { id = '' } = useParams();
  const units = useUnits();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { session } = useSession();
  const q = useQuery({ queryKey: ['challenge', id], queryFn: () => api<Challenge>(`/challenges/${id}`) });
  const c = q.data;
  useDocumentTitle(c?.title ?? 'Reto');
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['challenge', id] }); void qc.invalidateQueries({ queryKey: ['challenges'] }); };
  const join = useMutation({ mutationFn: () => api(`/challenges/${id}/join`, { method: 'POST' }), onSuccess: refresh, onError: toast.error });
  const leave = useMutation({ mutationFn: () => api(`/challenges/${id}/leave`, { method: 'POST' }), onSuccess: refresh, onError: toast.error });
  if (q.isPending) return <div className="page stack"><Skeleton w={260} h={32} /><Skeleton h={200} r={18} /></div>;
  if (!c) return <div className="page"><div className="card"><Empty icon={Trophy} title="Reto no disponible" /></div></div>;
  const ended = new Date(c.endsAt) < new Date();
  const me = c.leaderboard.find((r) => r.user.id === session?.user.id);
  const daysLeft = Math.max(0, Math.ceil((Date.parse(c.endsAt) - Date.now()) / 86_400_000));
  return (
    <div className="page page--narrow stack">
      <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => navigate(-1)} style={{ alignSelf: 'flex-start' }}>Volver</Button>
      <section className="card card--pad stack">
        <span className="xs subtle">{formatDate(c.startsAt)} – {formatDate(c.endsAt)}{c.sport ? ` · ${getSport(c.sport).label}` : ''}{c.clubId && <> · <Link className="link" to={`/clubes/${c.clubId}`}>Ver club</Link></>}</span>
        <h1>{c.title}</h1>
        {c.description && <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{c.description}</p>}
        <div className="stats-row">
          <Stat label="Objetivo" value={formatGoalValue(c.metric, c.target, units)} note={METRIC_LABEL[c.metric]} />
          <Stat label="Participantes" value={c.leaderboard.length} />
          <Stat label={ended ? 'Estado' : 'Quedan'} value={ended ? 'Finalizado' : `${daysLeft} días`} />
        </div>
        {me && (
          <div className="stack" style={{ ['--gap' as string]: '6px' }}>
            <div className="row between small"><span>Tu progreso</span><span className="num">{formatGoalValue(c.metric, me.value, units)} / {formatGoalValue(c.metric, c.target, units)}</span></div>
            <Progress value={me.value / c.target} label="Tu progreso en el reto" />
          </div>
        )}
        {!ended && (c.joined ? <Button variant="ghost" onClick={() => leave.mutate()}>Abandonar reto</Button> : <Button variant="primary" loading={join.isPending} onClick={() => join.mutate()}>Unirme al reto</Button>)}
        <p className="xs subtle">Cuentan las actividades no privadas registradas dentro de las fechas del reto.</p>
      </section>
      <section className="card">
        <div className="card__head"><h2 className="section-title">Clasificación</h2></div>
        <div className="list">
          {c.leaderboard.map((r) => (
            <Link key={r.user.id} to={`/atleta/${r.user.username}`} className="list-item" style={r.user.id === session?.user.id ? { background: 'var(--accent-soft)' } : undefined}>
              <span className="num subtle" style={{ width: 24 }}>{r.rank}</span>
              <Avatar url={mediaUrl(r.user.avatarUrl)} name={r.user.displayName} size="sm" />
              <span className="grow small" style={{ fontWeight: 600 }}>{r.user.displayName}</span>
              {r.completed && <CheckCircle2 width={18} style={{ color: 'var(--success)' }} aria-label="Completado" />}
              <strong className="num small">{formatGoalValue(c.metric, r.value, units)}</strong>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
