import { formatDistance, formatDuration, formatElevation } from '@trazo/core';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Award, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useDocumentTitle, useUnits } from '../../app/hooks';
import { MapView } from '../../components/MapView';
import { formatDate } from '../../components/format';
import { api, mediaUrl } from '../../data/api';
import type { UserCard } from '../../data/types';
import { useSession } from '../../data/session';
import { Avatar, Chip, Empty, Segmented, Skeleton, Stat } from '../../ui/primitives';

interface Segment { id: string; name: string; group: string; distanceM: number; elevGainM: number | null; avgGrade: number | null; lat: number[]; lng: number[]; createdAt: string; creator: string | null }
interface Entry { rank: number; user: UserCard; elapsedS: number; activityId: string; date: string; avgHr: number | null }
interface Board { total: number; entries: Entry[]; me: Entry | null; limited: boolean; limit: number }
interface MyEffort { id: string; elapsedS: number; date: string; activityId: string; activityName: string; flagged: boolean }

export default function SegmentPage() {
  const { id = '' } = useParams();
  const units = useUnits();
  const navigate = useNavigate();
  const { session } = useSession();
  const [period, setPeriod] = useState<'all' | 'year' | 'month' | 'week'>('all');
  const [scope, setScope] = useState<'all' | 'following'>('all');
  const seg = useQuery({ queryKey: ['segment', id], queryFn: () => api<Segment>(`/segments/${id}`) });
  const board = useQuery({ queryKey: ['segment-board', id, period, scope], queryFn: () => api<Board>(`/segments/${id}/leaderboard?period=${period}&scope=${scope}`) });
  const mine = useQuery({ queryKey: ['segment-mine', id], queryFn: () => api<MyEffort[]>(`/segments/${id}/efforts/me`) });
  useDocumentTitle(seg.data?.name ?? 'Segmento');
  const tracks = useMemo(() => (seg.data ? [{ id: 'seg', lat: seg.data.lat, lng: seg.data.lng }] : []), [seg.data]);

  if (seg.isPending) return <div className="page stack"><Skeleton w={240} h={30} /><Skeleton h={300} r={18} /></div>;
  if (!seg.data) return <div className="page"><Empty icon={Award} title="Segmento no disponible" /></div>;
  const s = seg.data;
  const best = mine.data?.filter((e) => !e.flagged).reduce<MyEffort | null>((b, e) => (!b || e.elapsedS < b.elapsedS ? e : b), null);

  return (
    <div className="page page--wide stack" style={{ ['--gap' as string]: '20px' }}>
      <button type="button" className="btn btn--ghost btn--sm" style={{ alignSelf: 'flex-start' }} onClick={() => navigate(-1)}><ArrowLeft /> Volver</button>
      <header>
        <span className="xs subtle">Segmento · {s.group === 'ride' ? 'Ciclismo' : 'A pie'}{s.creator ? ` · creado por @${s.creator}` : ''}</span>
        <h1>{s.name}</h1>
      </header>
      <div className="detail-hero">
        <MapView tracks={tracks} fitKey={s.id} label="Mapa del segmento" />
        <aside className="card card--pad stack">
          <div className="detail-stats">
            <Stat label="Distancia" value={formatDistance(s.distanceM, units)} />
            <Stat label="Desnivel +" value={formatElevation(s.elevGainM, units)} />
            <Stat label="Pendiente media" value={s.avgGrade != null ? `${s.avgGrade} %` : '–'} />
            <Stat label="Tu mejor marca" value={best ? formatDuration(best.elapsedS) : '–'} note={best ? formatDate(best.date) : undefined} />
          </div>
          <p className="xs subtle row" style={{ ['--gap' as string]: '6px', alignItems: 'flex-start' }}><ShieldCheck width={14} style={{ flex: 'none', marginTop: 2 }} /> Clasificación basada en actividades con GPS. Se excluyen intentos con velocidades imposibles para el deporte. No es una clasificación oficial.</p>
        </aside>
      </div>
      <div className="grid-2">
        <section className="card">
          <div className="card__head wrap" style={{ flexWrap: 'wrap' }}>
            <h2 className="section-title">Clasificación</h2>
            <div className="row wrap">
              <Segmented label="Ámbito" value={scope} onChange={setScope} options={[{ value: 'all', label: 'Todos' }, { value: 'following', label: 'Siguiendo' }]} />
              <Segmented label="Periodo" value={period} onChange={setPeriod} options={[{ value: 'all', label: 'Siempre' }, { value: 'year', label: 'Año' }, { value: 'month', label: 'Mes' }, { value: 'week', label: 'Semana' }]} />
            </div>
          </div>
          <div className="card__body table-wrap">
            {board.isPending ? <Skeleton h={200} /> : !board.data?.entries.length ? <Empty icon={Award} title="Sin intentos en este periodo" /> : (
              <table className="table">
                <thead><tr><th>#</th><th>Atleta</th><th>Fecha</th><th className="right">Tiempo</th></tr></thead>
                <tbody>
                  {board.data.entries.map((e) => (
                    <tr key={e.user.id} className={e.user.id === session?.user.id ? 'is-me' : undefined}>
                      <td>{e.rank}</td>
                      <td><Link to={`/atleta/${e.user.username}`} className="row" style={{ ['--gap' as string]: '8px' }}><Avatar url={mediaUrl(e.user.avatarUrl)} name={e.user.displayName} size="sm" /> {e.user.displayName}</Link></td>
                      <td className="muted"><Link to={`/actividad/${e.activityId}`}>{formatDate(e.date)}</Link></td>
                      <td className="right"><strong>{formatDuration(e.elapsedS)}</strong></td>
                    </tr>
                  ))}
                  {board.data.me && board.data.me.rank > board.data.limit && (
                    <tr className="is-me"><td>{board.data.me.rank}</td><td>Tú</td><td className="muted">{formatDate(board.data.me.date)}</td><td className="right"><strong>{formatDuration(board.data.me.elapsedS)}</strong></td></tr>
                  )}
                </tbody>
              </table>
            )}
            {board.data?.limited && <p className="xs subtle" style={{ marginTop: 8 }}>Mostrando {board.data.limit} de {board.data.total}. <Link className="link" to="/plus">Clasificación completa con Plus</Link></p>}
          </div>
        </section>
        <section className="card">
          <div className="card__head"><h2 className="section-title">Tus intentos</h2></div>
          <div className="list">
            {mine.data?.length === 0 && <div className="card__body"><p className="small subtle">Aún no has pasado por este segmento.</p></div>}
            {mine.data?.map((e) => (
              <Link key={e.id} to={`/actividad/${e.activityId}`} className="list-item">
                <span className="grow"><span className="small">{e.activityName}</span><div className="xs subtle">{formatDate(e.date)}</div></span>
                {best?.id === e.id && <Chip tone="accent">Récord</Chip>}
                {e.flagged && <Chip tone="warning">No válido</Chip>}
                <strong className="num">{formatDuration(e.elapsedS)}</strong>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
