import {
  SPORTS, SPORT_KEYS, cumulativeDistance, formatDistance, formatDuration, formatElevation, formatSportSpeed, getSport, type Stream, type Visibility,
} from '@trazo/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeft, CloudOff, Download, Flag, MoreHorizontal, Pencil, Share2, Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useDocumentTitle, useUnits } from '../../app/hooks';
import { RouteSvg } from '../../components/RouteSvg';
import { formatDateTime } from '../../components/format';
import { deleteActivityLocal, editActivity, resolveConflict } from '../../data/activities';
import { api, download, mediaUrl } from '../../data/api';
import { sync } from '../../data/sync';
import type { ActivityDTO } from '../../data/types';
import { useSession } from '../../data/session';
import { shareLink } from '../../platform/files';
import { Dialog, useConfirm } from '../../ui/dialog';
import { Avatar, Button, Chip, Empty, Field, IconButton, Input, Notice, Select, Skeleton, Stat, Textarea } from '../../ui/primitives';
import { SportIcon } from '../../ui/SportIcon';
import { useToast } from '../../ui/toast';
import { BestEfforts, HrZones, Laps, SegmentEfforts, Splits } from './ActivityAnalysis';
import { MapAndCharts } from './ActivityCharts';
import { useActivity, useStream } from './activityData';
import { Comments, Photos, Reactions } from './ActivitySocial';
import { ReportDialog } from '../social/ReportDialog';
import { VisibilityIcon } from '../../components/ActivityCard';

function EditDialog({ a, open, onClose }: { a: ActivityDTO; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: a.name, description: a.description, visibility: a.visibility, sport: a.sport, rpe: a.rpe });
  useEffect(() => { if (open) setForm({ name: a.name, description: a.description, visibility: a.visibility, sport: a.sport, rpe: a.rpe }); }, [open, a]);
  const save = async () => {
    try {
      await editActivity(a.id, { ...form, name: form.name.trim() || a.name });
      toast.show('Cambios guardados', { tone: 'success' });
      onClose();
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Editar actividad" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={save}>Guardar</Button></>}>
      <div className="form-grid">
        <Field label="Título">{(id) => <Input id={id} value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
        <Field label="Descripción">{(id) => <Textarea id={id} value={form.description} maxLength={4000} onChange={(e) => setForm({ ...form, description: e.target.value })} />}</Field>
        <div className="form-grid form-grid--2">
          <Field label="Deporte">{(id) => <Select id={id} value={form.sport} onChange={(e) => setForm({ ...form, sport: e.target.value })}>{SPORT_KEYS.map((k) => <option key={k} value={k}>{SPORTS[k]!.label}</option>)}</Select>}</Field>
          <Field label="Visibilidad">{(id) => <Select id={id} value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value as Visibility })}><option value="public">Todo el mundo</option><option value="followers">Seguidores</option><option value="private">Solo yo</option></Select>}</Field>
        </div>
        <Field label="Esfuerzo percibido (1–10)" hint="Opcional. Se usa para la carga si no hay frecuencia cardíaca.">
          {(id, d) => <Input id={id} aria-describedby={d} type="number" min={1} max={10} value={form.rpe ?? ''} onChange={(e) => setForm({ ...form, rpe: e.target.value ? Math.min(10, Math.max(1, Number(e.target.value))) : null })} />}
        </Field>
      </div>
    </Dialog>
  );
}

function SegmentDialog({ a, stream, open, onClose }: { a: ActivityDTO; stream: Stream; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const dist = useMemo(() => cumulativeDistance(stream), [stream]);
  const total = dist[dist.length - 1] ?? 0;
  const [range, setRange] = useState<[number, number]>([0, Math.min(total, 1000)]);
  const [name, setName] = useState('');
  const idx = (m: number) => { let i = 0; while (i < dist.length - 1 && dist[i]! < m) i++; return i; };
  const sub = useMemo(() => {
    const i0 = idx(range[0]), i1 = idx(range[1]);
    return { lat: stream.lat.slice(i0, i1 + 1), lng: stream.lng.slice(i0, i1 + 1), i0, i1 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, stream]);
  const create = useMutation({
    mutationFn: () => api<{ id: string; efforts: number }>('/segments', { method: 'POST', body: { activityId: a.id, startIndex: sub.i0, endIndex: sub.i1, name } }),
    onSuccess: (r) => { toast.show(`Segmento creado · ${r.efforts} intento(s) encontrados`, { tone: 'success' }); navigate(`/segmentos/${r.id}`); },
    onError: toast.error,
  });
  const len = range[1] - range[0];
  return (
    <Dialog open={open} onClose={onClose} title="Crear segmento" wide footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={create.isPending} disabled={name.trim().length < 3 || len < 200} onClick={() => create.mutate()}>Crear segmento</Button></>}>
      <div className="stack">
        <p className="small muted">Elige el tramo. Los segmentos son públicos: no pueden atravesar tus zonas privadas. Longitud entre 200 m y 50 km.</p>
        <RouteSvg lat={sub.lat} lng={sub.lng} height={180} />
        <Field label={`Inicio: ${(range[0] / 1000).toFixed(2)} km`}>{(id) => <input id={id} type="range" min={0} max={total} step={10} value={range[0]} onChange={(e) => setRange([Math.min(Number(e.target.value), range[1] - 50), range[1]])} />}</Field>
        <Field label={`Fin: ${(range[1] / 1000).toFixed(2)} km`}>{(id) => <input id={id} type="range" min={0} max={total} step={10} value={range[1]} onChange={(e) => setRange([range[0], Math.max(Number(e.target.value), range[0] + 50)])} />}</Field>
        <p className="small num">Longitud: <strong>{formatDistance(len)}</strong></p>
        <Field label="Nombre del segmento">{(id) => <Input id={id} value={name} maxLength={80} placeholder="Subida al mirador" onChange={(e) => setName(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

export default function ActivityPage() {
  const { id = '' } = useParams();
  const { data: a, local, loading, error } = useActivity(id);
  const { session } = useSession();
  const units = useUnits();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [segment, setSegment] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useDocumentTitle(a?.name ?? 'Actividad');
  const isOwner = !!a && a.owner.id === session?.user.id;
  const synced = !local || local.syncState === 'synced';
  const stream = useStream(id, !!a?.hasStream, isOwner);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menu]);

  if (loading) return <div className="page stack"><Skeleton w={260} h={32} /><Skeleton h={360} r={18} /><Skeleton h={200} r={18} /></div>;
  if (!a) {
    return (
      <div className="page">
        <div className="card"><Empty icon={AlertTriangle} title="Actividad no disponible" action={<Button onClick={() => navigate(-1)}>Volver</Button>}>{(error as Error | null)?.message ?? 'Puede que sea privada o que se haya eliminado.'}</Empty></div>
      </div>
    );
  }

  const sport = getSport(a.sport);
  const remove = async () => {
    if (!(await confirm({ title: 'Eliminar actividad', message: 'Se eliminará en todos tus dispositivos, junto con sus fotos, comentarios y resultados de segmentos.', confirmLabel: 'Eliminar', danger: true }))) return;
    await deleteActivityLocal(a.id);
    qc.removeQueries({ queryKey: ['activity', a.id] });
    void qc.invalidateQueries({ queryKey: ['feed'] });
    toast.show('Actividad eliminada');
    navigate('/actividades', { replace: true });
  };
  const share = async () => {
    const r = await shareLink(a.name, `${window.location.origin}/actividad/${a.id}`);
    if (r === 'copied') toast.show('Enlace copiado');
  };

  const statsPanel = (
    <aside className="card card--pad stack">
      <div className="detail-stats">
        {a.distanceM > 0 && <Stat label="Distancia" value={formatDistance(a.distanceM, units)} />}
        <Stat label="Tiempo en movimiento" value={formatDuration(a.movingS)} />
        {a.distanceM > 0 && <Stat label={sport.display === 'pace' ? 'Ritmo medio' : 'Velocidad media'} value={formatSportSpeed(a.sport, a.avgSpeed, units)} />}
        {a.elevGainM != null && <Stat label="Desnivel +" value={formatElevation(a.elevGainM, units)} />}
        <Stat label="Tiempo total" value={formatDuration(a.elapsedS)} />
        {a.maxSpeed > 0 && <Stat label="Velocidad máx." value={formatSportSpeed(a.sport, a.maxSpeed, units)} />}
        {a.avgHr != null && <Stat label="FC media" value={a.avgHr} unit="ppm" note={a.maxHr ? `máx. ${a.maxHr}` : undefined} />}
        {a.avgPower != null && <Stat label="Potencia media" value={a.avgPower} unit="W" note={a.maxPower ? `máx. ${a.maxPower} W` : undefined} />}
        {a.avgCadence != null && <Stat label="Cadencia" value={a.avgCadence} unit="rpm" />}
        {a.calories != null && <Stat label="Calorías" value={a.calories} unit="kcal" note="Estimación (MET × peso)" />}
        {isOwner && a.trainingLoad != null && <Stat label="Carga" value={a.trainingLoad} note={a.avgHr != null ? 'TRIMP' : 'Esfuerzo percibido'} />}
      </div>
      {a.source !== 'recorded' && <p className="xs subtle">{a.source === 'imported' ? 'Importada desde archivo' : 'Añadida manualmente'}</p>}
    </aside>
  );

  return (
    <div className="page page--wide stack" style={{ ['--gap' as string]: '20px' }}>
      <div className="row between">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => navigate(-1)}>Volver</Button>
        <div className="row" style={{ position: 'relative' }} ref={menuRef}>
          <IconButton icon={Share2} label="Compartir" onClick={share} />
          {isOwner && <IconButton icon={Pencil} label="Editar" onClick={() => setEditing(true)} />}
          <IconButton icon={MoreHorizontal} label="Más acciones" aria-expanded={menu} onClick={(e) => { e.stopPropagation(); setMenu((m) => !m); }} />
          {menu && (
            <div className="card menu" role="menu" style={{ position: 'absolute', right: 0, top: 44, zIndex: 10, minWidth: 220, padding: 6 }}>
              {isOwner && a.hasStream && synced && <>
                <button role="menuitem" className="list-item" onClick={() => void download(`/activities/${a.id}/export?format=gpx`, 'actividad.gpx').catch(toast.error)}><Download width={16} /> Exportar GPX</button>
                <button role="menuitem" className="list-item" onClick={() => void download(`/activities/${a.id}/export?format=tcx`, 'actividad.tcx').catch(toast.error)}><Download width={16} /> Exportar TCX</button>
                <button role="menuitem" className="list-item" onClick={() => { setMenu(false); setSegment(true); }}><Flag width={16} /> Crear segmento</button>
              </>}
              {!isOwner && <button role="menuitem" className="list-item" onClick={() => { setMenu(false); setReporting(true); }}><AlertTriangle width={16} /> Denunciar</button>}
              {isOwner && <button role="menuitem" className="list-item" style={{ color: 'var(--danger)' }} onClick={() => { setMenu(false); void remove(); }}><Trash2 width={16} /> Eliminar</button>}
            </div>
          )}
        </div>
      </div>

      {local?.syncState === 'conflict' && (
        <Notice icon={AlertTriangle} tone="warning">
          <strong>Esta actividad se editó en otro dispositivo.</strong> Elige qué versión conservar.
          <div className="row wrap" style={{ marginTop: 8 }}>
            <Button size="sm" variant="primary" onClick={() => void resolveConflict(a.id, 'mine')}>Conservar mis cambios</Button>
            <Button size="sm" onClick={() => void resolveConflict(a.id, 'server')}>Usar la otra versión{local.serverCopy ? ` («${local.serverCopy.name}»)` : ''}</Button>
          </div>
        </Notice>
      )}
      {local?.syncState === 'error' && (
        <Notice icon={AlertTriangle} tone="danger">
          No se pudo sincronizar: {local.lastError}. <button type="button" className="link" style={{ background: 'none', border: 0, padding: 0 }} onClick={() => void sync.run()}>Reintentar</button>
        </Notice>
      )}
      {local?.syncState === 'pending' && <Notice icon={CloudOff}>Guardada en este dispositivo. Se sincronizará automáticamente.</Notice>}

      <header className="stack" style={{ ['--gap' as string]: '10px' }}>
        <div className="row">
          <Link to={`/atleta/${a.owner.username}`}><Avatar url={mediaUrl(a.owner.avatarUrl)} name={a.owner.displayName} /></Link>
          <div>
            <Link to={`/atleta/${a.owner.username}`} style={{ fontWeight: 650 }}>{a.owner.displayName}</Link>
            <div className="small subtle row" style={{ ['--gap' as string]: '6px' }}><SportIcon sport={a.sport} size={14} /> {sport.label} · {formatDateTime(a.startedAt)} <VisibilityIcon v={a.visibility} /></div>
          </div>
        </div>
        <h1>{a.name}</h1>
        {a.description && <p style={{ whiteSpace: 'pre-wrap', maxWidth: '70ch' }}>{a.description}</p>}
        <Reactions a={a} synced={synced} />
      </header>

      {a.hasStream ? (
        stream.data ? (
          <MapAndCharts stream={stream.data} sport={a.sport} units={units} side={statsPanel} />
        ) : stream.isError ? (
          <div className="detail-hero"><Notice icon={CloudOff} tone="warning">No se pudo cargar el recorrido (sin conexión). {a.polyline && <RouteSvg polyline={a.polyline} />}</Notice>{statsPanel}</div>
        ) : (
          <div className="detail-hero"><Skeleton h={340} r={18} />{statsPanel}</div>
        )
      ) : (
        statsPanel
      )}

      <div className="grid-2 grid-2--even">
        <div className="stack">
          <Splits a={a} units={units} />
          <Laps a={a} units={units} />
        </div>
        <div className="stack">
          {isOwner && <BestEfforts a={a} />}
          <SegmentEfforts a={a} synced={synced} />
          <HrZones a={a} synced={synced} />
          {a.stats.bestEfforts?.length ? null : !a.stats.splits?.length && !isOwner ? <Chip>Sin análisis adicional</Chip> : null}
        </div>
      </div>
      <Photos a={a} isOwner={isOwner} synced={synced} />
      <Comments a={a} synced={synced} />

      {isOwner && <EditDialog a={a} open={editing} onClose={() => setEditing(false)} />}
      {isOwner && stream.data && segment && <SegmentDialog a={a} stream={stream.data} open={segment} onClose={() => setSegment(false)} />}
      {reporting && <ReportDialog targetType="activity" targetId={a.id} open={reporting} onClose={() => setReporting(false)} />}
    </div>
  );
}
