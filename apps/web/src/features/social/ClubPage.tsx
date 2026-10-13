import { SPORTS, formatDistance, formatDuration } from '@trazo/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Flag, LogOut, Shield, Trash2, Trophy, UserPlus, Users } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useDocumentTitle, useUnits } from '../../app/hooks';
import { ActivityCard } from '../../components/ActivityCard';
import { usePaged, useSentinel } from '../../components/hooks';
import { api, mediaUrl } from '../../data/api';
import type { ActivityDTO, UserCard } from '../../data/types';
import { useSession } from '../../data/session';
import { Dialog, useConfirm } from '../../ui/dialog';
import { Avatar, Button, Chip, Empty, Input, Skeleton } from '../../ui/primitives';
import { useToast } from '../../ui/toast';
import { ReportDialog } from './ReportDialog';
import { NewChallengeDialog } from './ChallengesPage';

interface Club { id: string; name: string; description: string; sport: string | null; visibility: 'public' | 'private'; createdAt: string; members: number; membership: { role: string; status: string } | null }
type Member = UserCard & { role: string; status: string };
interface BoardRow { rank: number; user: UserCard; distanceM: number; movingS: number; count: number }

function InviteDialog({ clubId, open, onClose }: { clubId: string; open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const d = useDeferredValue(q.trim());
  const toast = useToast();
  const people = useQuery({ queryKey: ['users', d], enabled: d.length >= 2, queryFn: () => api<UserCard[]>(`/users?q=${encodeURIComponent(d)}`) });
  const invite = useMutation({ mutationFn: (userId: string) => api(`/clubs/${clubId}/invite`, { method: 'POST', body: { userId } }), onSuccess: () => toast.show('Invitación enviada', { tone: 'success' }), onError: toast.error });
  return (
    <Dialog open={open} onClose={onClose} title="Invitar al club">
      <div className="stack">
        <Input aria-label="Buscar persona" placeholder="Nombre o usuario" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <div className="list">
          {people.data?.map((u) => (
            <div key={u.id} className="list-item">
              <Avatar url={mediaUrl(u.avatarUrl)} name={u.displayName} size="sm" />
              <span className="grow small">{u.displayName} <span className="subtle">@{u.username}</span></span>
              <Button size="sm" onClick={() => invite.mutate(u.id)}>Invitar</Button>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

export default function ClubPage() {
  const { id = '' } = useParams();
  const units = useUnits();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { session } = useSession();
  const [tab, setTab] = useState<'feed' | 'ranking' | 'members'>('feed');
  const [inviting, setInviting] = useState(false);
  const [challenge, setChallenge] = useState(false);
  const [report, setReport] = useState(false);
  const club = useQuery({ queryKey: ['club', id], queryFn: () => api<Club>(`/clubs/${id}`) });
  const c = club.data;
  useDocumentTitle(c?.name ?? 'Club');
  const active = c?.membership?.status === 'active';
  const isAdmin = active && (c?.membership?.role === 'owner' || c?.membership?.role === 'admin');
  const canSee = !!c && (c.visibility === 'public' || active);
  const feed = usePaged<ActivityDTO>(['club-feed', id], `/clubs/${id}/feed`, canSee && tab === 'feed');
  const sentinel = useSentinel(() => { if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage(); }, !!feed.hasNextPage);
  const board = useQuery({ queryKey: ['club-board', id], enabled: canSee && tab === 'ranking', queryFn: () => api<BoardRow[]>(`/clubs/${id}/leaderboard`) });
  const members = useQuery({ queryKey: ['club-members', id], enabled: !!c && tab === 'members', queryFn: () => api<Member[]>(`/clubs/${id}/members`) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['club', id] }); void qc.invalidateQueries({ queryKey: ['clubs'] }); void qc.invalidateQueries({ queryKey: ['club-members', id] }); };
  const join = useMutation({ mutationFn: () => api<{ status: string }>(`/clubs/${id}/join`, { method: 'POST' }), onSuccess: (r) => { refresh(); toast.show(r.status === 'active' ? '¡Bienvenido al club!' : 'Solicitud enviada'); }, onError: toast.error });
  const leave = useMutation({ mutationFn: () => api(`/clubs/${id}/leave`, { method: 'POST' }), onSuccess: refresh, onError: toast.error });
  const member = useMutation({ mutationFn: ({ userId, action }: { userId: string; action: string }) => api(`/clubs/${id}/members/${userId}/${action}`, { method: 'POST' }), onSuccess: refresh, onError: toast.error });
  const del = useMutation({ mutationFn: () => api(`/clubs/${id}`, { method: 'DELETE' }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['clubs'] }); navigate('/comunidad', { replace: true }); }, onError: toast.error });

  if (club.isPending) return <div className="page stack"><Skeleton w={280} h={36} /><Skeleton h={200} r={18} /></div>;
  if (!c) return <div className="page"><div className="card"><Empty icon={Users} title="Club no disponible">Puede que sea privado o que se haya eliminado.</Empty></div></div>;

  return (
    <div className="page page--wide">
      <section className="card card--pad stack" style={{ marginBottom: 20 }}>
        <div className="row between wrap">
          <div className="stack" style={{ ['--gap' as string]: '4px' }}>
            <span className="xs subtle row" style={{ ['--gap' as string]: '6px' }}>{c.visibility === 'private' ? <><Shield width={14} /> Club privado</> : 'Club público'}{c.sport ? ` · ${SPORTS[c.sport]?.label}` : ''} · {c.members} miembro{c.members === 1 ? '' : 's'}</span>
            <h1>{c.name}</h1>
          </div>
          <div className="row wrap">
            {!c.membership && <Button variant="primary" loading={join.isPending} onClick={() => join.mutate()}>{c.visibility === 'public' ? 'Unirme' : 'Solicitar unirme'}</Button>}
            {c.membership?.status === 'invited' && <Button variant="primary" icon={Check} onClick={() => join.mutate()}>Aceptar invitación</Button>}
            {c.membership?.status === 'requested' && <Chip>Solicitud pendiente</Chip>}
            {isAdmin && <Button icon={UserPlus} onClick={() => setInviting(true)}>Invitar</Button>}
            {isAdmin && <Button icon={Trophy} onClick={() => setChallenge(true)}>Crear reto</Button>}
            {active && c.membership?.role !== 'owner' && <Button variant="ghost" icon={LogOut} onClick={async () => { if (await confirm({ title: 'Salir del club', message: `Dejarás de ver el contenido de ${c.name}.`, confirmLabel: 'Salir' })) leave.mutate(); }}>Salir</Button>}
            {c.membership?.role === 'owner' && <Button variant="danger-ghost" icon={Trash2} onClick={async () => { if (await confirm({ title: 'Eliminar club', message: 'Se eliminarán el club, sus miembros y sus retos. No se puede deshacer.', confirmLabel: 'Eliminar', danger: true })) del.mutate(); }}>Eliminar</Button>}
            {!c.membership?.role?.match(/owner/) && <Button variant="ghost" size="sm" icon={Flag} aria-label="Denunciar club" onClick={() => setReport(true)} />}
          </div>
        </div>
        {c.description && <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{c.description}</p>}
      </section>

      <div className="tabs" role="tablist" style={{ marginBottom: 16 }}>
        {(['feed', 'ranking', 'members'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t === 'feed' ? 'Actividad' : t === 'ranking' ? 'Clasificación semanal' : 'Miembros'}</button>
        ))}
      </div>

      {!canSee && tab !== 'members' ? (
        <div className="card"><Empty icon={Shield} title="Contenido solo para miembros" /></div>
      ) : tab === 'feed' ? (
        <div className="feed" style={{ maxWidth: 720 }}>
          {feed.isPending && <Skeleton h={240} r={18} />}
          {feed.isSuccess && !feed.items.length && <div className="card"><Empty icon={Users} title="Sin actividad pública reciente" /></div>}
          {feed.items.map((a) => <ActivityCard key={a.id} a={a} />)}
          <div ref={sentinel} />
        </div>
      ) : tab === 'ranking' ? (
        <div className="card table-wrap" style={{ maxWidth: 720 }}>
          {board.isPending ? <div className="card__body"><Skeleton h={120} /></div> : (
            <table className="table">
              <thead><tr><th>#</th><th>Atleta</th><th className="right">Distancia</th><th className="right">Tiempo</th><th className="right">Act.</th></tr></thead>
              <tbody>
                {board.data?.map((r) => (
                  <tr key={r.user.id} className={r.user.id === session?.user.id ? 'is-me' : undefined}>
                    <td>{r.rank}</td>
                    <td><Link to={`/atleta/${r.user.username}`} className="row" style={{ ['--gap' as string]: '8px' }}><Avatar url={mediaUrl(r.user.avatarUrl)} name={r.user.displayName} size="sm" />{r.user.displayName}</Link></td>
                    <td className="right">{formatDistance(r.distanceM, units, 1)}</td>
                    <td className="right">{formatDuration(r.movingS, { compact: true })}</td>
                    <td className="right">{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="xs subtle" style={{ padding: 12 }}>Semana en curso. Solo cuentan actividades no privadas.</p>
        </div>
      ) : (
        <div className="card" style={{ maxWidth: 720 }}>
          <div className="list">
            {members.data?.map((m) => (
              <div key={m.id} className="list-item">
                <Avatar url={mediaUrl(m.avatarUrl)} name={m.displayName} size="sm" />
                <Link to={`/atleta/${m.username}`} className="grow small" style={{ fontWeight: 600 }}>{m.displayName}</Link>
                {m.role !== 'member' && <Chip tone="accent">{m.role === 'owner' ? 'Propietario' : 'Admin'}</Chip>}
                {m.status !== 'active' && <Chip tone="warning">{m.status === 'invited' ? 'Invitado' : 'Solicitud'}</Chip>}
                {isAdmin && m.role !== 'owner' && m.id !== session?.user.id && (
                  <div className="row" style={{ ['--gap' as string]: '4px' }}>
                    {m.status === 'requested' && <Button size="sm" variant="primary" onClick={() => member.mutate({ userId: m.id, action: 'approve' })}>Aprobar</Button>}
                    {m.status === 'active' && m.role === 'member' && <Button size="sm" variant="ghost" onClick={() => member.mutate({ userId: m.id, action: 'promote' })}>Hacer admin</Button>}
                    {m.role === 'admin' && <Button size="sm" variant="ghost" onClick={() => member.mutate({ userId: m.id, action: 'demote' })}>Quitar admin</Button>}
                    <Button size="sm" variant="danger-ghost" onClick={async () => { if (await confirm({ title: 'Quitar miembro', message: `${m.displayName} dejará de pertenecer al club.`, confirmLabel: 'Quitar', danger: true })) member.mutate({ userId: m.id, action: 'remove' }); }}>Quitar</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <InviteDialog clubId={c.id} open={inviting} onClose={() => setInviting(false)} />
      {challenge && <NewChallengeDialog clubId={c.id} open={challenge} onClose={() => setChallenge(false)} />}
      {report && <ReportDialog targetType="club" targetId={c.id} open={report} onClose={() => setReport(false)} />}
    </div>
  );
}
