import { CircleDot, FileUp, Users } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { useDocumentTitle, useIsDesktop } from '../../app/hooks';
import { ActivityCard } from '../../components/ActivityCard';
import { usePaged, useSentinel } from '../../components/hooks';
import { WeekSummary } from '../../components/WeekSummary';
import type { ActivityDTO } from '../../data/types';
import { useMe } from '../../data/session';
import { Button, Empty, Notice, Skeleton } from '../../ui/primitives';
import { AlertTriangle } from 'lucide-react';

export default function FeedPage() {
  useDocumentTitle('Inicio');
  const me = useMe();
  const navigate = useNavigate();
  const desktop = useIsDesktop();
  const feed = usePaged<ActivityDTO>(['feed'], '/feed');
  const sentinel = useSentinel(() => { if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage(); }, !!feed.hasNextPage);

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1>Hola, {me.displayName.split(' ')[0]}</h1>
          <p>Lo último de tu gente y tus entrenamientos.</p>
        </div>
        {desktop && (
          <div className="row">
            <Button icon={FileUp} onClick={() => navigate('/actividades/importar')}>Importar</Button>
            <Button variant="primary" icon={CircleDot} onClick={() => navigate('/grabar')}>Grabar</Button>
          </div>
        )}
      </div>
      <div className="grid-2">
        <div className="feed">
          {!desktop && <WeekSummary />}
          {feed.isPending && Array.from({ length: 3 }, (_, i) => <Skeleton key={i} h={300} r={18} />)}
          {feed.isError && (
            <Notice icon={AlertTriangle} tone="warning">
              No se pudo cargar el feed {feed.error && 'isNetwork' in feed.error && (feed.error as { isNetwork: boolean }).isNetwork ? 'sin conexión' : ''}. Tus actividades siguen disponibles en <Link className="link" to="/actividades">Actividades</Link>.
            </Notice>
          )}
          {feed.isSuccess && feed.items.length === 0 && (
            <div className="card">
              <Empty icon={Users} title="Tu feed está vacío" action={<div className="row wrap" style={{ justifyContent: 'center' }}><Button variant="primary" icon={CircleDot} onClick={() => navigate('/grabar')}>Graba tu primera actividad</Button><Button onClick={() => navigate('/comunidad')}>Buscar personas</Button></div>}>
                Sigue a otras personas o graba una actividad para empezar a llenarlo.
              </Empty>
            </div>
          )}
          {feed.items.map((a) => <ActivityCard key={a.id} a={a} />)}
          <div ref={sentinel} />
          {feed.isFetchingNextPage && <Skeleton h={260} r={18} />}
        </div>
        {desktop && (
          <aside className="sticky-rail stack">
            <WeekSummary />
          </aside>
        )}
      </div>
    </div>
  );
}
