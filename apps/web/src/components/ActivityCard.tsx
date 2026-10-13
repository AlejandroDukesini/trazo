import { formatDistance, formatDuration, formatElevation, formatSportSpeed, getSport } from '@trazo/core';
import { Lock } from 'lucide-react';
import { memo } from 'react';
import { Link } from 'react-router';
import { useUnits } from '../app/hooks';
import { mediaUrl } from '../data/api';
import type { ActivityDTO, LocalActivity } from '../data/types';
import { SportIcon } from '../ui/SportIcon';
import { relativeDate } from './format';
import { RouteSvg } from './RouteSvg';

export const VisibilityIcon = ({ v }: { v: ActivityDTO['visibility'] }) =>
  v === 'private' ? <Lock aria-label="Solo tú" width={14} height={14} /> : null;

/** Tarjeta de actividad del historial. */
export const ActivityCard = memo(function ActivityCard({ a }: { a: ActivityDTO | LocalActivity; showOwner?: boolean }) {
  const units = useUnits();
  const sport = getSport(a.sport);
  const showDistance = a.distanceM > 0;
  return (
    <article className="activity-card card">
      <Link to={`/actividad/${a.id}`} className="activity-card__link" aria-label={`Ver ${a.name}`} />
      <header className="activity-card__head">
        <span className="xs subtle row" style={{ ['--gap' as string]: '6px' }}>
          <SportIcon sport={a.sport} size={14} /> {sport.label} · {relativeDate(a.startedAt)} <VisibilityIcon v={a.visibility} />
        </span>
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
    </article>
  );
});
