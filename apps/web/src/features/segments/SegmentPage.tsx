import { formatDistance, formatDuration, formatElevation } from '@trazo/core';
import { useQuery } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Award, ShieldCheck, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useDocumentTitle, useUnits } from '../../app/hooks';
import { MapView } from '../../components/MapView';
import { formatDate } from '../../components/format';
import { userDb } from '../../data/db';
import { computeEfforts, deleteSegment } from '../../data/segments-local';
import { useConfirm } from '../../ui/dialog';
import { Button, Chip, Empty, Skeleton, Stat } from '../../ui/primitives';

export default function SegmentPage() {
  const { id = '' } = useParams();
  const units = useUnits();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const seg = useLiveQuery(() => userDb().segments.get(id), [id]);
  const efforts = useQuery({ queryKey: ['segment-efforts', id], enabled: !!seg, queryFn: () => computeEfforts(seg!) });
  useDocumentTitle(seg?.name ?? 'Segmento');
  const tracks = useMemo(() => (seg ? [{ id: 'seg', lat: seg.points.map((p) => p.lat), lng: seg.points.map((p) => p.lng) }] : []), [seg]);

  if (seg === undefined) return <div className="page stack"><Skeleton w={240} h={30} /><Skeleton h={300} r={18} /></div>;
  if (!seg) return <div className="page"><Empty icon={Award} title="Segmento no disponible" /></div>;
  const best = efforts.data?.find((e) => e.isPersonalBest) ?? null;

  const remove = async () => {
    if (!(await confirm({ title: 'Eliminar segmento', message: 'Se eliminará este segmento personal. Tus actividades no se tocan.', confirmLabel: 'Eliminar', danger: true }))) return;
    await deleteSegment(id);
    navigate('/actividades', { replace: true });
  };

  return (
    <div className="page page--wide stack" style={{ ['--gap' as string]: '20px' }}>
      <div className="row between">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate(-1)}><ArrowLeft /> Volver</button>
        <Button variant="ghost" size="sm" icon={Trash2} onClick={remove}>Eliminar</Button>
      </div>
      <header>
        <span className="xs subtle">Segmento personal · {seg.group === 'ride' ? 'Ciclismo' : 'A pie'}</span>
        <h1>{seg.name}</h1>
      </header>
      <div className="detail-hero">
        <MapView tracks={tracks} fitKey={seg.id} label="Mapa del segmento" />
        <aside className="card card--pad stack">
          <div className="detail-stats">
            <Stat label="Distancia" value={formatDistance(seg.distanceM, units)} />
            <Stat label="Desnivel +" value={formatElevation(seg.elevGainM, units)} />
            <Stat label="Pendiente media" value={seg.avgGrade != null ? `${seg.avgGrade} %` : '–'} />
            <Stat label="Tu mejor marca" value={best ? formatDuration(best.elapsedS) : '–'} note={best ? formatDate(best.startedAt) : undefined} />
          </div>
          <p className="xs subtle row" style={{ ['--gap' as string]: '6px', alignItems: 'flex-start' }}><ShieldCheck width={14} style={{ flex: 'none', marginTop: 2 }} /> Tus intentos se detectan automáticamente en tus actividades con GPS. Se excluyen tramos con velocidades imposibles para el deporte.</p>
        </aside>
      </div>
      <section className="card">
        <div className="card__head"><h2 className="section-title">Tus intentos</h2></div>
        <div className="card__body table-wrap">
          {efforts.isPending ? <Skeleton h={160} /> : !efforts.data?.length ? <Empty icon={Award} title="Aún no has pasado por este segmento" /> : (
            <table className="table">
              <thead><tr><th>#</th><th>Actividad</th><th>Fecha</th><th className="right">Tiempo</th></tr></thead>
              <tbody>
                {efforts.data.map((e, i) => (
                  <tr key={e.activityId + i} className={e.isPersonalBest ? 'is-me' : undefined}>
                    <td>{i + 1}</td>
                    <td><Link to={`/actividad/${e.activityId}`} className="ellipsis">{e.activityName}</Link></td>
                    <td className="muted">{formatDate(e.startedAt)}</td>
                    <td className="right row" style={{ justifyContent: 'flex-end', ['--gap' as string]: '6px' }}>
                      {e.isPersonalBest && <Chip tone="accent">Récord</Chip>}
                      {e.flagged && <Chip tone="warning">No válido</Chip>}
                      <strong>{formatDuration(e.elapsedS)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
