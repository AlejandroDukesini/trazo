import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Flame, MessageCircle, UserPlus, Users, Check, X } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { useDocumentTitle } from '../../app/hooks';
import { usePaged, useSentinel } from '../../components/hooks';
import { relativeDate } from '../../components/format';
import { api, mediaUrl } from '../../data/api';
import type { UserCard } from '../../data/types';
import { Avatar, Button, Empty, Skeleton } from '../../ui/primitives';
import { useToast } from '../../ui/toast';

interface Notification { id: string; kind: string; entityId: string | null; data: Record<string, string>; read: boolean; createdAt: string; actor: UserCard | null }

function describe(n: Notification): { text: string; to: string; icon: typeof Bell } {
  const who = n.actor?.displayName ?? 'Alguien';
  switch (n.kind) {
    case 'follow': return { text: `${who} ha empezado a seguirte`, to: `/atleta/${n.actor?.username}`, icon: UserPlus };
    case 'follow_request': return { text: `${who} quiere seguirte`, to: `/notificaciones`, icon: UserPlus };
    case 'follow_accepted': return { text: `${who} ha aceptado tu solicitud`, to: `/atleta/${n.actor?.username}`, icon: UserPlus };
    case 'reaction': return { text: `${who} ha dado ánimo a «${n.data.activityName ?? 'tu actividad'}»`, to: `/actividad/${n.entityId}`, icon: Flame };
    case 'comment': return { text: `${who} ha comentado «${n.data.activityName ?? 'tu actividad'}»: ${n.data.excerpt ?? ''}`, to: `/actividad/${n.entityId}#comentarios`, icon: MessageCircle };
    case 'club_invite': return { text: `${who} te ha invitado al club ${n.data.clubName ?? ''}`, to: `/clubes/${n.entityId}`, icon: Users };
    case 'club_request': return { text: `${who} quiere unirse a ${n.data.clubName ?? 'tu club'}`, to: `/clubes/${n.entityId}`, icon: Users };
    default: return { text: 'Nueva notificación', to: '/', icon: Bell };
  }
}

function FollowRequests() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['follow-requests'], queryFn: () => api<UserCard[]>('/me/follow-requests') });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'accept' | 'reject' }) => api(`/me/follow-requests/${id}/${action}`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['follow-requests'] }),
    onError: toast.error,
  });
  if (!q.data?.length) return null;
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="card__head"><h2 className="section-title">Solicitudes para seguirte</h2></div>
      <div className="list">
        {q.data.map((u) => (
          <div key={u.id} className="list-item">
            <Avatar url={mediaUrl(u.avatarUrl)} name={u.displayName} size="sm" />
            <Link to={`/atleta/${u.username}`} className="grow small" style={{ fontWeight: 600 }}>{u.displayName}</Link>
            <Button size="sm" variant="primary" icon={Check} onClick={() => act.mutate({ id: u.id, action: 'accept' })}>Aceptar</Button>
            <Button size="sm" variant="ghost" icon={X} aria-label="Rechazar" onClick={() => act.mutate({ id: u.id, action: 'reject' })} />
          </div>
        ))}
      </div>
    </section>
  );
}

export default function NotificationsPage() {
  useDocumentTitle('Notificaciones');
  const qc = useQueryClient();
  const list = usePaged<Notification>(['notifications', 'list'], '/notifications');
  const sentinel = useSentinel(() => { if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage(); }, !!list.hasNextPage);
  const markAll = useMutation({
    mutationFn: () => api('/notifications/read', { method: 'POST', body: {} }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['notifications'] }); },
  });
  // Al abrir la pantalla, se marcan como leídas tras un instante.
  useEffect(() => {
    const t = setTimeout(() => markAll.mutate(), 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="page page--narrow">
      <div className="page__head"><h1>Notificaciones</h1><Button size="sm" variant="ghost" icon={CheckCheck} onClick={() => markAll.mutate()}>Marcar todo como leído</Button></div>
      <FollowRequests />
      <div className="card">
        {list.isPending && <div className="card__body"><Skeleton h={56} /><Skeleton h={56} style={{ marginTop: 8 }} /></div>}
        {list.isSuccess && list.items.length === 0 && <Empty icon={Bell} title="Nada nuevo">Aquí verás ánimos, comentarios, seguidores e invitaciones.</Empty>}
        <div className="list">
          {list.items.map((n) => {
            const d = describe(n);
            return (
              <Link key={n.id} to={d.to} className="list-item" style={n.read ? undefined : { background: 'var(--accent-soft)' }}>
                {n.actor ? <Avatar url={mediaUrl(n.actor.avatarUrl)} name={n.actor.displayName} size="sm" /> : <span className="list-item__icon"><d.icon aria-hidden /></span>}
                <span className="grow small">{d.text}<div className="xs subtle">{relativeDate(n.createdAt)}</div></span>
                <d.icon width={16} className="subtle" aria-hidden />
              </Link>
            );
          })}
        </div>
        <div ref={sentinel} />
      </div>
    </div>
  );
}
