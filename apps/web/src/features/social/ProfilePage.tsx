import { formatDistance, formatDuration, formatElevation } from '@trazo/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Flag, Lock, MapPin, Settings, UserCheck, UserPlus, Users, MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useDocumentTitle, useUnits } from '../../app/hooks';
import { ActivityCard } from '../../components/ActivityCard';
import { usePaged, useSentinel } from '../../components/hooks';
import { formatDate } from '../../components/format';
import { api, mediaUrl } from '../../data/api';
import type { ActivityDTO, UserCard } from '../../data/types';
import { Dialog, useConfirm } from '../../ui/dialog';
import { Avatar, Button, Empty, IconButton, Skeleton, Stat } from '../../ui/primitives';
import { useToast } from '../../ui/toast';
import { ReportDialog } from './ReportDialog';

interface Profile {
  id: string; username: string; displayName: string; avatarUrl: string | null; bio: string; location: string; isPrivate: boolean; createdAt: string;
  followers: number; following: number;
  relation: { self: boolean; following: boolean; pending: boolean; followsYou: boolean; blocked: boolean };
  canSeeActivities: boolean;
  yearStats: { count: number; distanceM: number; movingS: number; elevGainM: number } | null;
}

function PeopleDialog({ userId, kind, onClose }: { userId: string; kind: 'followers' | 'following' | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['people', userId, kind], enabled: !!kind, queryFn: () => api<UserCard[]>(`/users/${userId}/${kind}`) });
  return (
    <Dialog open={!!kind} onClose={onClose} title={kind === 'followers' ? 'Seguidores' : 'Siguiendo'}>
      <div className="list">
        {q.isPending && <Skeleton h={48} />}
        {q.data?.length === 0 && <p className="small subtle">Nadie todavía.</p>}
        {q.data?.map((u) => (
          <Link key={u.id} to={`/atleta/${u.username}`} className="list-item" onClick={onClose}>
            <Avatar url={mediaUrl(u.avatarUrl)} name={u.displayName} size="sm" />
            <span className="grow"><strong className="small">{u.displayName}</strong><div className="xs subtle">@{u.username}</div></span>
          </Link>
        ))}
      </div>
    </Dialog>
  );
}

export default function ProfilePage() {
  const { username = '' } = useParams();
  const units = useUnits();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [people, setPeople] = useState<'followers' | 'following' | null>(null);
  const [menu, setMenu] = useState(false);
  const [report, setReport] = useState(false);
  const q = useQuery({ queryKey: ['profile', username], queryFn: () => api<Profile>(`/users/${encodeURIComponent(username)}`) });
  const p = q.data;
  useDocumentTitle(p?.displayName ?? 'Perfil');
  const acts = usePaged<ActivityDTO>(['user-activities', p?.id], `/activities?user=${p?.id}`, !!p && p.canSeeActivities);
  const sentinel = useSentinel(() => { if (acts.hasNextPage && !acts.isFetchingNextPage) void acts.fetchNextPage(); }, !!acts.hasNextPage);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['profile', username] }); void qc.invalidateQueries({ queryKey: ['feed'] }); };
  const follow = useMutation({ mutationFn: () => api<{ status: string }>(`/users/${p!.id}/follow`, { method: 'POST' }), onSuccess: (r) => { refresh(); if (r.status === 'pending') toast.show('Solicitud enviada'); }, onError: toast.error });
  const unfollow = useMutation({ mutationFn: () => api(`/users/${p!.id}/follow`, { method: 'DELETE' }), onSuccess: refresh, onError: toast.error });
  const block = useMutation({ mutationFn: (on: boolean) => api(`/users/${p!.id}/block`, { method: on ? 'POST' : 'DELETE' }), onSuccess: refresh, onError: toast.error });

  if (q.isPending) return <div className="page stack"><Skeleton w={300} h={80} /><Skeleton h={200} r={18} /></div>;
  if (!p) return <div className="page"><div className="card"><Empty icon={Users} title="Perfil no encontrado" /></div></div>;
  const r = p.relation;

  return (
    <div className="page">
      <section className="card card--pad stack" style={{ marginBottom: 20 }}>
        <div className="profile-head">
          <Avatar url={mediaUrl(p.avatarUrl)} name={p.displayName} size="xl" />
          <div className="grow stack" style={{ ['--gap' as string]: '6px' }}>
            <h1 className="row" style={{ ['--gap' as string]: '8px' }}>{p.displayName} {p.isPrivate && <Lock width={18} aria-label="Cuenta privada" className="subtle" />}</h1>
            <span className="muted">@{p.username}{r.followsYou && !r.self ? ' · Te sigue' : ''}</span>
            {p.location && <span className="small muted row" style={{ ['--gap' as string]: '4px' }}><MapPin width={14} /> {p.location}</span>}
            {p.bio && <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{p.bio}</p>}
            <div className="profile-head__meta">
              <button type="button" className="link" style={{ background: 'none', border: 0, padding: 0 }} onClick={() => setPeople('followers')}><strong>{p.followers}</strong> seguidores</button>
              <button type="button" className="link" style={{ background: 'none', border: 0, padding: 0 }} onClick={() => setPeople('following')}><strong>{p.following}</strong> siguiendo</button>
              <span>Desde {formatDate(p.createdAt)}</span>
            </div>
          </div>
          <div className="row" style={{ position: 'relative' }}>
            {r.self ? (
              <Button icon={Settings} onClick={() => navigate('/ajustes')}>Editar perfil</Button>
            ) : r.blocked ? (
              <Button onClick={() => block.mutate(false)}>Desbloquear</Button>
            ) : r.following ? (
              <Button icon={UserCheck} onClick={() => unfollow.mutate()} loading={unfollow.isPending}>Siguiendo</Button>
            ) : r.pending ? (
              <Button onClick={() => unfollow.mutate()}>Solicitud enviada</Button>
            ) : (
              <Button variant="primary" icon={UserPlus} onClick={() => follow.mutate()} loading={follow.isPending}>Seguir</Button>
            )}
            {!r.self && <IconButton icon={MoreHorizontal} label="Más opciones" onClick={() => setMenu((m) => !m)} />}
            {menu && (
              <div className="card" role="menu" style={{ position: 'absolute', right: 0, top: 46, zIndex: 10, minWidth: 200, padding: 6 }}>
                {!r.blocked && <button role="menuitem" className="list-item" onClick={async () => { setMenu(false); if (await confirm({ title: `Bloquear a ${p.displayName}`, message: 'No podrá ver tu contenido, seguirte ni interactuar contigo. También dejaréis de seguiros.', confirmLabel: 'Bloquear', danger: true })) block.mutate(true); }}><Ban width={16} /> Bloquear</button>}
                <button role="menuitem" className="list-item" onClick={() => { setMenu(false); setReport(true); }}><Flag width={16} /> Denunciar</button>
              </div>
            )}
          </div>
        </div>
        {p.yearStats && (
          <div className="stats-row" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <Stat label={`${new Date().getFullYear()} · actividades`} value={p.yearStats.count} />
            <Stat label="Distancia" value={formatDistance(p.yearStats.distanceM, units, 0)} />
            <Stat label="Tiempo" value={formatDuration(p.yearStats.movingS, { compact: true })} />
            <Stat label="Desnivel" value={formatElevation(p.yearStats.elevGainM, units)} />
          </div>
        )}
      </section>

      {!p.canSeeActivities ? (
        <div className="card"><Empty icon={Lock} title="Cuenta privada">Sigue a {p.displayName} para ver sus actividades cuando acepte tu solicitud.</Empty></div>
      ) : (
        <div className="feed">
          {acts.isPending && <Skeleton h={260} r={18} />}
          {acts.isSuccess && acts.items.length === 0 && <div className="card"><Empty icon={Users} title="Sin actividades visibles" /></div>}
          {acts.items.map((a) => <ActivityCard key={a.id} a={a} />)}
          <div ref={sentinel} />
        </div>
      )}
      <PeopleDialog userId={p.id} kind={people} onClose={() => setPeople(null)} />
      {report && <ReportDialog targetType="user" targetId={p.id} open={report} onClose={() => setReport(false)} />}
    </div>
  );
}
