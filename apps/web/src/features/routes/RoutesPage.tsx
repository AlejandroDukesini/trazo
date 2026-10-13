import { formatDistance, formatElevation, getSport } from '@trazo/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Route as RouteIcon, Star } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { useDocumentTitle, useUnits } from '../../app/hooks';
import { RouteSvg } from '../../components/RouteSvg';
import { formatDate } from '../../components/format';
import { userDb } from '../../data/db';
import { Button, Empty, Skeleton } from '../../ui/primitives';
import { SportIcon } from '../../ui/SportIcon';

export default function RoutesPage() {
  useDocumentTitle('Rutas');
  const units = useUnits();
  const navigate = useNavigate();
  const routes = useLiveQuery(() => userDb().routes.orderBy('updatedAt').reverse().toArray(), []);
  return (
    <div className="page page--wide">
      <div className="page__head">
        <div><h1>Rutas</h1><p>Planifica recorridos, guárdalos y síguelos durante tus actividades.</p></div>
        <Button variant="primary" icon={Plus} onClick={() => navigate('/rutas/nueva')}>Nueva ruta</Button>
      </div>
      {!routes && <div className="grid-3"><Skeleton h={220} r={18} /><Skeleton h={220} r={18} /><Skeleton h={220} r={18} /></div>}
      {routes?.length === 0 && (
        <div className="card"><Empty icon={RouteIcon} title="Aún no tienes rutas" action={<Button variant="primary" icon={Plus} onClick={() => navigate('/rutas/nueva')}>Crear ruta</Button>}>Dibuja una ruta en el mapa o importa un archivo GPX.</Empty></div>
      )}
      <div className="grid-3">
        {routes?.map((r) => (
          <Link key={r.id} to={`/rutas/${r.id}`} className="card activity-card">
            {r.geometry.lat.length > 1 && <RouteSvg lat={r.geometry.lat} lng={r.geometry.lng} height={150} />}
            <div className="card__body stack" style={{ ['--gap' as string]: '6px' }}>
              <div className="row between"><strong className="ellipsis">{r.name}</strong>{r.favorite && <Star width={16} height={16} fill="currentColor" style={{ color: 'var(--warning)' }} aria-label="Favorita" />}</div>
              <span className="small muted row" style={{ ['--gap' as string]: '6px' }}><SportIcon sport={r.sport} size={14} /> {getSport(r.sport).label} · {formatDistance(r.distanceM, units)}{r.elevGainM != null ? ` · ${formatElevation(r.elevGainM, units)} +` : ''}</span>
              <span className="xs subtle">Actualizada {formatDate(r.updatedAt)}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
