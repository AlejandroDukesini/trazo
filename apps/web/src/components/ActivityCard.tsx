import { formatDistance, formatDuration, formatElevation, formatSportSpeed, getSport } from '@trazo/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CloudOff, Flame, Lock, MessageCircle, Users, AlertTriangle } from 'lucide-react';
import { memo } from 'react';
import { Link } from 'react-router';
import { useUnits } from '../app/hooks';
import { api, mediaUrl } from '../data/api';
import type { ActivityDTO, LocalActivity } from '../data/types';
import { SportIcon } from '../ui/SportIcon';
import { Avatar } from '../ui/primitives';
import { useToast } from '../ui/toast';
import { RouteSvg } from './RouteSvg';
import { relativeDate } from './format';

export const VisibilityIcon = ({ v }: { v: ActivityDTO['visibility'] }) =>
  v === 'private' ? <Lock aria-label="Solo tú" width={14} height={14} /> : v === 'followers' ? <Users aria-label="Seguidores" width={14} height={14} /> : null;

/** Tarjeta de actividad del feed y del historial. */
export const ActivityCard = memo(function ActivityCard({ a, showOwner = true }: { a: ActivityDTO | LocalActivity; showOwner?: boolean }) {
  const units = useUnits();
  const local = 'syncState' in a ? a : null;
  const qc = useQueryClient();
  const toast = useToast();
  const react = useMutation({
    mutationFn: () => api(`/activities/${a.id}/reaction`, { method: a.viewerReacted ? 'DELETE' : 'PUT' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feed'] }),
    onError: toast.error,
  });
  const sport = getSport(a.sport);
  const showDistance = a.distanceM > 0;
  return (
    <article className="activity-card card">
      <Link to={`/actividad/${a.id}`} className="activity-card__link" aria-label={`Ver ${a.name}`} />
      <header className="activity-card__head">
        {showOwner ? (
          <Link to={`/atleta/${a.owner.username}`} className="row" style={{ position: 'relative', zIndex: 1 }}>
            <Avatar url={mediaUrl(a.owner.avatarUrl)} name={a.owner.displayName} size="sm" />
            <span className="stack" style={{ ['--gap' as string]: '0px' }}>
              <strong className="small">{a.owner.displayName}</strong>
              <span className="xs subtle row" style={{ ['--gap' as string]: '6px' }}>
                <SportIcon sport={a.sport} size={13} /> {relativeDate(a.startedAt)} <VisibilityIcon v={a.visibility} />
              </span>
            </span>
          </Link>
        ) : (
          <span className="xs subtle row" style={{ ['--gap' as string]: '6px' }}>
            <SportIcon sport={a.sport} size={14} /> {sport.label} · {relativeDate(a.startedAt)} <VisibilityIcon v={a.visibility} />
          </span>
        )}
        {local && local.syncState !== 'synced' && (
          <span className={`chip ${local.syncState === 'pending' ? 'chip--warning' : 'chip--danger'}`} style={{ position: 'relative', zIndex: 1 }}>
            {local.syncState === 'pending' ? <><CloudOff width={13} height={13} /> Pendiente</> : <><AlertTriangle width={13} height={13} /> {local.syncState === 'conflict' ? 'Conflicto' : 'Error'}</>}
          </span>
        )}
      </header>
      <h3 className="activity-card__title">{a.name}</h3>
      <div className="activity-card__stats">
        {showDistance && <div><span>Distancia</span><strong className="num">{formatDistance(a.distanceM, units)}</strong></div>}
        {showDistance && <div><span>{sport.display === 'pace' ? 'Ritmo' : 'Velocidad'}</span><strong className="num">{formatSportSpeed(a.sport, a.avgSpeed, units)}</strong></div>}
        <div><span>Tiempo</span><strong className="num">{formatDuration(a.movingS)}</strong></div>
        {a.elevGainM != null && a.elevGainM > 0 && <div className="hide-xs"><span>Desnivel</span><strong className="num">{formatElevation(a.elevGainM, units)}</strong></div>}
      </div>
      {a.polyline && <RouteSvg polyline={a.polyline} className="activity-card__map" />}
      {!!a.photos.length && (
        <div className="activity-card__photos">
          {a.photos.slice(0, 3).map((p) => <img key={p.id} src={mediaUrl(p.url)!} alt="" loading="lazy" />)}
        </div>
      )}
      {showOwner && (
        <footer className="activity-card__foot">
          <button type="button" className={['react-btn', a.viewerReacted && 'is-on'].filter(Boolean).join(' ')} onClick={() => react.mutate()} disabled={react.isPending} aria-pressed={a.viewerReacted} aria-label="Dar ánimo">
            <Flame aria-hidden /> <span className="num">{a.reactionCount || ''}</span>
          </button>
          <Link to={`/actividad/${a.id}#comentarios`} className="react-btn" aria-label="Comentarios">
            <MessageCircle aria-hidden /> <span className="num">{a.commentCount || ''}</span>
          </Link>
        </footer>
      )}
    </article>
  );
});
