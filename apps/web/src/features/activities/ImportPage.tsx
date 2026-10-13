import {
  ImportError, MAX_IMPORT_BYTES, SPORTS, SPORT_KEYS, computeStats, formatDistance, formatDuration, parseTrackFile, parsedToStream, uuidv7,
  type ParsedFile, type Stream, type Visibility,
} from '@trazo/core';
import { FileUp, PenLine, Upload, AlertTriangle } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useDocumentTitle, useUnits } from '../../app/hooks';
import { RouteSvg } from '../../components/RouteSvg';
import { saveNewActivity } from '../../data/activities';
import { defaultActivityName } from '../../data/recorder';
import { useMe } from '../../data/session';
import { Button, Field, Input, Notice, Segmented, Select, Stat, Textarea } from '../../ui/primitives';
import { useToast } from '../../ui/toast';

interface Prepared {
  parsed: ParsedFile;
  stream: Stream;
  startedAt: number;
  dropped: number;
  fileName: string;
}

function toLocalInput(d: Date) {
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

function FileImport() {
  const me = useMe();
  const units = useUnits();
  const toast = useToast();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [prep, setPrep] = useState<Prepared | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sport, setSport] = useState('run');
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<Visibility>(me.defaultVisibility);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  const load = async (file: File) => {
    setError(null);
    setPrep(null);
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new ImportError('El archivo supera 15 MB.');
      const text = await file.text();
      const parsed = parseTrackFile(file.name, text);
      if (!parsed.timed) throw new ImportError('El archivo no tiene horas en los puntos: parece una ruta. Impórtalo desde Rutas.');
      const s = parsed.sport ?? sport;
      const { stream, startedAt, dropped } = parsedToStream(parsed, s);
      if (stream.t.length < 2) throw new ImportError('El archivo no tiene suficientes puntos válidos.');
      setSport(s);
      setName(parsed.name ?? defaultActivityName(s, new Date(startedAt)));
      setPrep({ parsed, stream, startedAt, dropped, fileName: file.name });
    } catch (err) {
      setError(err instanceof ImportError ? err.message : 'No se pudo leer el archivo. ¿Es un GPX o TCX válido?');
    }
  };

  const save = async () => {
    if (!prep) return;
    setBusy(true);
    try {
      const n = prep.stream.t.length;
      const a = await saveNewActivity({
        id: uuidv7(), sport, name: name.trim() || 'Actividad importada', description: '', visibility,
        startedAt: new Date(prep.startedAt).toISOString(), source: 'imported',
        elapsedS: Math.max(1, Math.round(prep.stream.t[n - 1]! / 1000)), stream: prep.stream, device: `Archivo ${prep.parsed.format.toUpperCase()}`,
      }, me);
      toast.show('Actividad importada', { tone: 'success' });
      navigate(`/actividad/${a.id}`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const stats = prep ? computeStats(prep.stream, sport) : null;
  return (
    <div className="stack">
      <div
        className="card card--pad"
        style={{ borderStyle: 'dashed', borderWidth: 2, textAlign: 'center', background: drag ? 'var(--accent-soft)' : undefined }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) void load(f); }}
      >
        <div className="stack" style={{ alignItems: 'center' }}>
          <div className="empty__icon"><Upload aria-hidden /></div>
          <p><strong>Arrastra un archivo GPX o TCX</strong> o selecciónalo</p>
          <Button icon={FileUp} onClick={() => input.current?.click()}>Elegir archivo</Button>
          <input ref={input} type="file" accept=".gpx,.tcx,application/gpx+xml,application/xml,text/xml" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ''; }} />
          <p className="xs subtle">Máximo 15 MB. Se conservan FC, cadencia y potencia si el archivo las incluye.</p>
        </div>
      </div>
      {error && <Notice icon={AlertTriangle} tone="danger">{error}</Notice>}
      {prep && stats && (
        <div className="card card--pad stack">
          <RouteSvg lat={prep.stream.lat} lng={prep.stream.lng} height={200} />
          <div className="stats-row">
            <Stat label="Distancia" value={formatDistance(stats.distanceM, units)} />
            <Stat label="Tiempo" value={formatDuration(stats.movingS)} />
            <Stat label="Puntos" value={stats.pointCount} />
          </div>
          {prep.dropped > 0 && <p className="xs subtle">Se descartaron {prep.dropped} puntos duplicados o con saltos imposibles.</p>}
          <div className="form-grid form-grid--2">
            <Field label="Título">{(id) => <Input id={id} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />}</Field>
            <Field label="Deporte">{(id) => <Select id={id} value={sport} onChange={(e) => setSport(e.target.value)}>{SPORT_KEYS.map((k) => <option key={k} value={k}>{SPORTS[k]!.label}</option>)}</Select>}</Field>
            <Field label="Visibilidad">{(id) => <Select id={id} value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}><option value="public">Todo el mundo</option><option value="followers">Seguidores</option><option value="private">Solo yo</option></Select>}</Field>
          </div>
          <Button variant="primary" size="lg" loading={busy} onClick={save}>Guardar actividad</Button>
        </div>
      )}
    </div>
  );
}

function ManualEntry() {
  const me = useMe();
  const toast = useToast();
  const navigate = useNavigate();
  const [f, setF] = useState({ sport: 'run', name: '', when: toLocalInput(new Date()), h: '0', m: '45', s: '0', km: '', elev: '', description: '', visibility: me.defaultVisibility as Visibility, rpe: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const duration = Number(f.h) * 3600 + Number(f.m) * 60 + Number(f.s);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (duration <= 0) return toast.show('Indica la duración', { tone: 'danger' });
    setBusy(true);
    try {
      const when = new Date(f.when);
      const a = await saveNewActivity({
        id: uuidv7(), sport: f.sport, name: f.name.trim() || defaultActivityName(f.sport, when), description: f.description, visibility: f.visibility,
        startedAt: when.toISOString(), source: 'manual', elapsedS: duration, stream: null,
        rpe: f.rpe ? Number(f.rpe) : null,
        manual: { distanceM: f.km ? Number(f.km) * 1000 : 0, movingS: duration, elevGainM: f.elev ? Number(f.elev) : undefined },
      }, me);
      toast.show('Actividad añadida', { tone: 'success' });
      navigate(`/actividad/${a.id}`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card card--pad form-grid" onSubmit={submit}>
      <div className="form-grid form-grid--2">
        <Field label="Deporte">{(id) => <Select id={id} value={f.sport} onChange={set('sport')}>{SPORT_KEYS.map((k) => <option key={k} value={k}>{SPORTS[k]!.label}</option>)}</Select>}</Field>
        <Field label="Fecha y hora">{(id) => <Input id={id} type="datetime-local" value={f.when} max={toLocalInput(new Date())} onChange={set('when')} />}</Field>
      </div>
      <Field label="Título">{(id) => <Input id={id} value={f.name} placeholder={defaultActivityName(f.sport)} onChange={set('name')} />}</Field>
      <div className="field">
        <span className="field__label">Duración</span>
        <div className="row">
          <Input aria-label="Horas" type="number" min={0} max={99} value={f.h} onChange={set('h')} /> h
          <Input aria-label="Minutos" type="number" min={0} max={59} value={f.m} onChange={set('m')} /> min
          <Input aria-label="Segundos" type="number" min={0} max={59} value={f.s} onChange={set('s')} /> s
        </div>
      </div>
      <div className="form-grid form-grid--2">
        <Field label="Distancia (km)" hint="Opcional">{(id, d) => <Input id={id} aria-describedby={d} type="number" min={0} step="0.01" value={f.km} onChange={set('km')} />}</Field>
        <Field label="Desnivel positivo (m)" hint="Opcional">{(id, d) => <Input id={id} aria-describedby={d} type="number" min={0} value={f.elev} onChange={set('elev')} />}</Field>
        <Field label="Esfuerzo percibido (1–10)" hint="Opcional">{(id, d) => <Input id={id} aria-describedby={d} type="number" min={1} max={10} value={f.rpe} onChange={set('rpe')} />}</Field>
        <Field label="Visibilidad">{(id) => <Select id={id} value={f.visibility} onChange={set('visibility')}><option value="public">Todo el mundo</option><option value="followers">Seguidores</option><option value="private">Solo yo</option></Select>}</Field>
      </div>
      <Field label="Descripción">{(id) => <Textarea id={id} value={f.description} onChange={set('description')} />}</Field>
      <p className="xs subtle">Las actividades manuales no participan en segmentos ni récords de mejores esfuerzos.</p>
      <Button type="submit" variant="primary" size="lg" loading={busy}>Añadir actividad</Button>
    </form>
  );
}

export default function ImportPage() {
  useDocumentTitle('Importar actividad');
  const [mode, setMode] = useState<'file' | 'manual'>('file');
  return (
    <div className="page page--narrow">
      <div className="page__head">
        <div>
          <h1>Añadir actividad</h1>
          <p>Importa un archivo de tu reloj o ciclocomputador, o registra una sesión a mano.</p>
        </div>
      </div>
      <div className="stack">
        <Segmented label="Modo" value={mode} onChange={setMode} options={[{ value: 'file', label: 'Archivo GPX/TCX', icon: FileUp }, { value: 'manual', label: 'Manual', icon: PenLine }]} />
        {mode === 'file' ? <FileImport /> : <ManualEntry />}
      </div>
    </div>
  );
}
