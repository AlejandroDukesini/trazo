import {
  SPORTS, SPORT_KEYS, cumulativeDistance, formatDistance, formatDuration, formatElevation, formatSportSpeed, getSport, streamToGpx, streamToTcx, type Stream, type Visibility,
} from '@trazo/core';
import { useMutation } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeft, CloudOff, Download, Flag, MoreHorizontal, Pencil, Share2, Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useDocumentTitle, useUnits } from '../../app/hooks';
import { RouteSvg } from '../../components/RouteSvg';
import { formatDateTime } from '../../components/format';
import { deleteActivityLocal, editActivity } from '../../data/activities';
import { userDb } from '../../data/db';
import { createSegmentFromActivity } from '../../data/segments-local';
import type { ActivityDTO } from '../../data/types';
import { shareLink, saveFile } from '../../platform/files';
import { Dialog, useConfirm } from '../../ui/dialog';
import { Button, Chip, Empty, Field, IconButton, Input, Notice, Select, Skeleton, Stat, Textarea } from '../../ui/primitives';
import { SportIcon } from '../../ui/SportIcon';
import { useToast } from '../../ui/toast';
import { BestEfforts, HrZones, Laps, SegmentEfforts, Splits } from './ActivityAnalysis';
import { MapAndCharts } from './ActivityCharts';
import { useActivity, useStream } from './activityData';
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
        <Field label="Deporte">{(id) => <Select id={id} value={form.sport} onChange={(e) => setForm({ ...form, sport: e.target.value })}>{SPORT_KEYS.map((k) => <option key={k} value={k}>{SPORTS[k]!.label}</option>)}</Select>}</Field>
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
    mutationFn: () => createSegmentFromActivity(a.id, sub.i0, sub.i1, name),
    onSuccess: (segId) => { toast.show('Segmento creado', { tone: 'success' }); navigate(`/segmentos/${segId}`); },
    onError: toast.error,
  });
  const len = range[1] - range[0];
  return (
    <Dialog open={open} onClose={onClose} title="Crear segmento" wide footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={create.isPending} disabled={name.trim().length < 3 || len < 200} onClick={() => create.mutate()}>Crear segmento</Button></>}>
      <div className="stack">
        <p className="small muted">Elige el tramo. Un segmento personal detecta automáticamente tus intentos en todas tus actividades. Longitud mínima 200 m.</p>
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
  const { data: a, loading, error } = useActivity(id);
  const units = useUnits();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [segment, setSegment] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useDocumentTitle(a?.name ?? 'Actividad');
  const stream = useStream(id, !!a?.hasStream);

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
        <div className="card"><Empty icon={AlertTriangle} title="Actividad no disponible" action={<Button onClick={() => navigate(-1)}>Volver</Button>}>{(error as Error | null)?.message ?? 'Puede que se haya eliminado.'}</Empty></div>
      </div>
    );
  }

  const sport = getSport(a.sport);
  const remove = async () => {
    if (!(await confirm({ title: 'Eliminar actividad', message: 'Se eliminará de este dispositivo, junto con su recorrido y fotos.', confirmLabel: 'Eliminar', danger: true }))) return;
    await deleteActivityLocal(a.id);
    toast.show('Actividad eliminada');
    navigate('/actividades', { replace: true });
  };
  const share = async () => {
    const r = await shareLink(a.name, `${window.location.origin}/actividad/${a.id}`);
    if (r === 'copied') toast.show('Enlace copiado');
  };
  const exportAs = async (format: 'gpx' | 'tcx') => {
    try {
      const stored = await userDb().streams.get(a.id);
      if (!stored) { toast.show('Esta actividad no tiene recorrido para exportar'); return; }
      const meta = { name: a.name, sport: a.sport, startedAt: Date.parse(a.startedAt), description: a.description };
      const xml = format === 'gpx' ? streamToGpx(stored.stream, meta) : streamToTcx(stored.stream, meta);
      await saveFile(`${a.name.replace(/[^\w.-]+/g, '_') || 'actividad'}.${format}`, new Blob([xml], { type: 'application/xml' }));
    } catch (err) {
      toast.error(err);
    }
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
        {a.trainingLoad != null && <Stat label="Carga" value={a.trainingLoad} note={a.avgHr != null ? 'TRIMP' : 'Esfuerzo percibido'} />}
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
          <IconButton icon={Pencil} label="Editar" onClick={() => setEditing(true)} />
          <IconButton icon={MoreHorizontal} label="Más acciones" aria-expanded={menu} onClick={(e) => { e.stopPropagation(); setMenu((m) => !m); }} />
          {menu && (
            <div className="card menu" role="menu" style={{ position: 'absolute', right: 0, top: 44, zIndex: 10, minWidth: 220, padding: 6 }}>
              {a.hasStream && <>
                <button role="menuitem" className="list-item" onClick={() => { setMenu(false); void exportAs('gpx'); }}><Download width={16} /> Exportar GPX</button>
                <button role="menuitem" className="list-item" onClick={() => { setMenu(false); void exportAs('tcx'); }}><Download width={16} /> Exportar TCX</button>
                <button role="menuitem" className="list-item" onClick={() => { setMenu(false); setSegment(true); }}><Flag width={16} /> Crear segmento</button>
              </>}
              <button role="menuitem" className="list-item" style={{ color: 'var(--danger)' }} onClick={() => { setMenu(false); void remove(); }}><Trash2 width={16} /> Eliminar</button>
            </div>
          )}
        </div>
      </div>

      <header className="stack" style={{ ['--gap' as string]: '10px' }}>
        <div className="small subtle row" style={{ ['--gap' as string]: '6px' }}><SportIcon sport={a.sport} size={14} /> {sport.label} · {formatDateTime(a.startedAt)} <VisibilityIcon v={a.visibility} /></div>
        <h1>{a.name}</h1>
        {a.description && <p style={{ whiteSpace: 'pre-wrap', maxWidth: '70ch' }}>{a.description}</p>}
      </header>

      {a.hasStream ? (
        stream.data ? (
          <MapAndCharts stream={stream.data} sport={a.sport} units={units} side={statsPanel} />
        ) : stream.isError ? (
          <div className="detail-hero"><Notice icon={CloudOff} tone="warning">No se pudo cargar el recorrido. {a.polyline && <RouteSvg polyline={a.polyline} />}</Notice>{statsPanel}</div>
        ) : (
          <div className="detail-hero"><Skeleton h={340} r={18} />{statsPanel}</div>
        )
      ) : (
        statsPanel
      )}

      {!!a.photos.length && (
        <div className="activity-card__photos" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
          {a.photos.map((p) => <img key={p.id} src={p.url} alt="" loading="lazy" style={{ borderRadius: 12, width: '100%' }} />)}
        </div>
      )}

      <div className="grid-2 grid-2--even">
        <div className="stack">
          <Splits a={a} units={units} />
          <Laps a={a} units={units} />
        </div>
        <div className="stack">
          <BestEfforts a={a} />
          <SegmentEfforts a={a} />
          <HrZones a={a} />
          {!a.stats.bestEfforts?.length && !a.stats.splits?.length && <Chip>Sin análisis adicional</Chip>}
        </div>
      </div>

      <EditDialog a={a} open={editing} onClose={() => setEditing(false)} />
      {stream.data && segment && <SegmentDialog a={a} stream={stream.data} open={segment} onClose={() => setSegment(false)} />}
    </div>
  );
}
