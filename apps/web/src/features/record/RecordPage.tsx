import {
  GPS_SPORT_KEYS, SPORTS, formatDistance, formatDuration, formatElevation, formatSportSpeed, getSport, type Visibility,
} from '@trazo/core';
import {
  AlertTriangle, BatteryWarning, ChevronDown, Flag, Lock, Map as MapIcon, Pause, Play, RotateCcw, Save, Smartphone, Trash2, Unlock, Gauge,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { cumulativeDistance, pointToSegmentDistance } from '@trazo/core';
import { getRoute } from '../../data/routes-local';
import { useDocumentTitle, useNow, useRecorder, useUnits } from '../../app/hooks';
import { MapView } from '../../components/MapView';
import { defaultActivityName, recorder } from '../../data/recorder';
import { useMe } from '../../data/session';
import { platform } from '../../platform';
import { TrazoTracker } from '../../platform/tracker';
import { useConfirm } from '../../ui/dialog';
import { Button, Field, HoldButton, IconButton, Input, Notice, Select, Stat, Textarea } from '../../ui/primitives';
import { sportIcon } from '../../ui/SportIcon';
import { useToast } from '../../ui/toast';

const GPS_LABEL = { off: 'GPS apagado', searching: 'Buscando GPS', ok: 'GPS listo', weak: 'Señal débil', denied: 'Sin permiso', error: 'Error de GPS' } as const;

/** Mantiene la pantalla encendida mientras se graba en la web (Screen Wake Lock API). */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || platform !== 'web' || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch {
        /* denegado (batería baja, etc.) */
      }
    };
    void acquire();
    const onVis = () => { if (document.visibilityState === 'visible' && !cancelled) void acquire(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      void lock?.release();
    };
  }, [active]);
}

function SaveForm() {
  const rec = useRecorder();
  const me = useMe();
  const units = useUnits();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const s = rec.session!;
  const startedAt = new Date(s.startedAt ?? Date.now());
  const [name, setName] = useState(s.draft?.name ?? defaultActivityName(s.sport, startedAt));
  const [description, setDescription] = useState(s.draft?.description ?? '');
  const [visibility, setVisibility] = useState<Visibility>((s.draft?.visibility as Visibility) ?? me.defaultVisibility);
  const [rpe, setRpe] = useState<number | null>(s.draft?.rpe ?? null);
  const [busy, setBusy] = useState(false);
  const timer = recorder.timer(Date.now());

  // Guarda el borrador para no perderlo si la app se cierra en esta pantalla.
  useEffect(() => {
    const t = setTimeout(() => recorder.saveDraft({ name, description, visibility, rpe }), 400);
    return () => clearTimeout(t);
  }, [name, description, visibility, rpe]);

  const save = async () => {
    setBusy(true);
    try {
      const a = await recorder.save({ name: name.trim() || defaultActivityName(s.sport, startedAt), description, visibility, rpe }, me);
      toast.show(navigator.onLine ? 'Actividad guardada' : 'Actividad guardada en el dispositivo. Se sincronizará al recuperar la conexión.', { tone: 'success' });
      navigate(a ? `/actividad/${a.id}` : '/actividades', { replace: true });
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    if (!(await confirm({ title: 'Descartar actividad', message: 'Se eliminarán la grabación y todos sus puntos. Esta acción no se puede deshacer.', confirmLabel: 'Descartar', danger: true }))) return;
    await recorder.discard();
    navigate('/', { replace: true });
  };

  return (
    <div className="page page--narrow stack" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 16px)' }}>
      <h1>Guardar actividad</h1>
      {s.status === 'error' && <Notice icon={AlertTriangle} tone="danger">No se pudo guardar: {s.error}. Tus datos siguen en el dispositivo; inténtalo de nuevo.</Notice>}
      <div className="card card--pad stats-row">
        <Stat label="Distancia" value={formatDistance(rec.distanceM, units)} />
        <Stat label="Tiempo" value={formatDuration(timer / 1000)} />
        <Stat label="Desnivel" value={formatElevation(rec.elevGainM, units)} />
      </div>
      {rec.pointCount < 2 && <Notice icon={AlertTriangle} tone="warning">No se registró recorrido GPS. Se guardará solo con el tiempo.</Notice>}
      <div className="card card--pad form-grid">
        <Field label="Título">{(id) => <Input id={id} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Descripción">{(id) => <Textarea id={id} value={description} maxLength={4000} placeholder="¿Cómo ha ido?" onChange={(e) => setDescription(e.target.value)} />}</Field>
        <Field label="Quién puede verla">
          {(id) => (
            <Select id={id} value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
              <option value="public">Todo el mundo</option>
              <option value="followers">Seguidores</option>
              <option value="private">Solo yo</option>
            </Select>
          )}
        </Field>
        <div className="field">
          <span className="field__label">Esfuerzo percibido (opcional)</span>
          <div className="rpe" role="group" aria-label="Esfuerzo percibido del 1 al 10">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button key={n} type="button" aria-pressed={rpe === n} onClick={() => setRpe(rpe === n ? null : n)}>{n}</button>
            ))}
          </div>
          <span className="field__hint">1 = muy suave · 10 = máximo. Se usa para estimar la carga de entrenamiento si no hay pulsómetro.</span>
        </div>
      </div>
      <div className="row between">
        <Button variant="danger-ghost" icon={Trash2} onClick={discard}>Descartar</Button>
        <Button variant="primary" size="lg" icon={Save} loading={busy} onClick={save}>Guardar</Button>
      </div>
    </div>
  );
}

export default function RecordPage() {
  useDocumentTitle('Grabar');
  const rec = useRecorder();
  const units = useUnits();
  const navigate = useNavigate();
  const [view, setView] = useState<'map' | 'metrics'>('map');
  const [locked, setLocked] = useState(false);
  const [battery, setBattery] = useState<boolean | null>(null);
  const status = rec.session?.status ?? 'ready';
  const active = status === 'recording' || status === 'paused';
  const now = useNow(1000, active);
  useWakeLock(status === 'recording');

  useEffect(() => {
    void recorder.warmUp();
    if (platform === 'android') TrazoTracker.isIgnoringBatteryOptimizations().then((r) => setBattery(r.value)).catch(() => setBattery(null));
    return () => { void recorder.coolDown(); };
  }, []);

  const sport = getSport(rec.session?.sport ?? rec.sport);
  const speedNow = recorder.currentSpeed(now);
  const avgSpeed = rec.movingMs > 0 ? rec.distanceM / (rec.movingMs / 1000) : null;
  const track = useMemo(() => [{ id: 'live', lat: rec.track.lat, lng: rec.track.lng }], [rec.track]);
  const timerS = recorder.timer(now) / 1000;
  const lastSplit = rec.splits.at(-1);
  const fitKey = useRef(0);
  const [params] = useSearchParams();
  const routeId = params.get('ruta');
  const route = useQuery({
    queryKey: ['route', routeId],
    enabled: !!routeId,
    queryFn: async () => {
      const r = await getRoute(routeId!);
      return r ? { name: r.name, geometry: { lat: r.geometry.lat, lng: r.geometry.lng } } : null;
    },
    staleTime: Infinity,
  });
  const guide = useMemo(() => {
    const g = route.data?.geometry;
    if (!g) return null;
    return { lat: g.lat, lng: g.lng, dist: cumulativeDistance({ lat: g.lat, lng: g.lng }) };
  }, [route.data]);
  // Navegación: distancia a la ruta y distancia restante desde el punto más cercano.
  const nav = useMemo(() => {
    const p = rec.gps.position;
    if (!guide || !p) return null;
    let best = Infinity, idx = 0;
    for (let i = 1; i < guide.lat.length; i++) {
      const d = pointToSegmentDistance(p, { lat: guide.lat[i - 1]!, lng: guide.lng[i - 1]! }, { lat: guide.lat[i]!, lng: guide.lng[i]! });
      if (d < best) { best = d; idx = i; }
    }
    const total = guide.dist[guide.dist.length - 1] ?? 0;
    return { off: best, remaining: Math.max(0, total - (guide.dist[idx] ?? 0)) };
  }, [guide, rec.gps.position]);
  const allTracks = useMemo(() => (guide ? [{ id: 'guide', lat: guide.lat, lng: guide.lng, color: '#8a93a3', width: 6, opacity: 0.6 }, ...track] : track), [guide, track]);

  if (status === 'finishing' || status === 'error') return <SaveForm />;

  const close = () => navigate(-1);

  return (
    <div className={['rec', view === 'metrics' && 'rec--metrics'].filter(Boolean).join(' ')}>
      <div className="rec__top">
        <IconButton icon={ChevronDown} label={active ? 'Minimizar (sigue grabando)' : 'Cerrar'} onClick={close} />
        <span className={`gps-chip gps-chip--${rec.gps.status}`} role="status">
          <i aria-hidden /> {GPS_LABEL[rec.gps.status]}{rec.gps.accuracy != null && rec.gps.status !== 'off' ? ` · ±${Math.round(rec.gps.accuracy)} m` : ''}
        </span>
        <span className="grow" />
        {active && <IconButton icon={view === 'map' ? Gauge : MapIcon} label={view === 'map' ? 'Ver solo métricas' : 'Ver mapa'} onClick={() => setView(view === 'map' ? 'metrics' : 'map')} />}
        {active && <IconButton icon={Lock} label="Bloquear controles" onClick={() => setLocked(true)} />}
      </div>

      <div className="rec__map">
        <MapView tracks={allTracks} live={rec.gps.position} follow fitKey={guide ? 'guide' : fitKey.current} label="Mapa de la grabación" />
      </div>

      <section className="rec__panel stack" aria-live="off">
        {status === 'ready' && (
          <>
            <div className="sport-picker" role="group" aria-label="Deporte">
              {GPS_SPORT_KEYS.map((k) => {
                const Icon = sportIcon(k);
                return (
                  <button key={k} type="button" aria-pressed={rec.sport === k} onClick={() => recorder.setSport(k)}>
                    <Icon aria-hidden /> {SPORTS[k]!.label}
                  </button>
                );
              })}
            </div>
            {rec.gps.status === 'denied' && (
              <Notice icon={AlertTriangle} tone="danger">
                {rec.gps.message ?? 'Sin permiso de ubicación.'} {platform === 'web' ? 'Actívalo en los permisos del sitio del navegador.' : 'Actívalo en los ajustes de la app.'}
              </Notice>
            )}
            {platform === 'web' && (
              <Notice icon={Smartphone}>
                En el navegador, la ubicación solo se registra con la pantalla encendida y Trazo en primer plano. Para grabar con la pantalla apagada usa la app de Android.
              </Notice>
            )}
            {platform === 'android' && battery === false && (
              <Notice icon={BatteryWarning} tone="warning">
                El ahorro de batería puede interrumpir grabaciones largas.{' '}
                <button type="button" className="link" style={{ background: 'none', border: 0, padding: 0 }} onClick={() => void TrazoTracker.openBatterySettings()}>Desactivar optimización</button>
              </Notice>
            )}
            {route.data && <Notice icon={MapIcon} tone="accent">Ruta cargada: {route.data.name}</Notice>}
            <Button variant="primary" size="xl" block icon={Play} disabled={rec.gps.status === 'denied'} onClick={() => void recorder.start()}>
              Iniciar {sport.label.toLowerCase()}
            </Button>
            {rec.gps.status === 'searching' && <p className="xs subtle" style={{ textAlign: 'center' }}>Puedes empezar ya; la distancia se contará en cuanto haya señal.</p>}
          </>
        )}

        {active && (
          <>
            {rec.gapWarning && <Notice icon={AlertTriangle} tone="warning">{rec.gapWarning}</Notice>}
            {nav && (
              <Notice icon={MapIcon} tone={nav.off > 60 ? 'warning' : 'accent'}>
                {nav.off > 60 ? `Te has salido de la ruta (${Math.round(nav.off)} m).` : `En ruta «${route.data?.name}».`} Quedan {formatDistance(nav.remaining, units)}.
              </Notice>
            )}
            <div className="rec__primary">
              <div className="label">{status === 'paused' ? 'En pausa' : 'Tiempo'}</div>
              <div className="value">{formatDuration(timerS)}</div>
            </div>
            <div className="rec__grid">
              <Stat label="Distancia" value={formatDistance(rec.distanceM, units)} />
              <Stat label={sport.display === 'pace' ? 'Ritmo' : 'Velocidad'} value={formatSportSpeed(sport.key, speedNow, units)} note={`Media ${formatSportSpeed(sport.key, avgSpeed, units)}`} />
              <Stat label={lastSplit ? `Km ${lastSplit.index}` : 'Desnivel +'} value={lastSplit ? formatDuration(lastSplit.timeMs / 1000) : formatElevation(rec.elevGainM, units)} />
            </div>
            <div className="rec__controls">
              {status === 'recording' ? (
                <>
                  <Button className="rec__round" variant="secondary" aria-label="Vuelta" icon={Flag} onClick={() => void recorder.lap()} />
                  <Button className="rec__round" variant="primary" aria-label="Pausar" icon={Pause} onClick={() => void recorder.pause()} />
                  <span style={{ width: 84 }} />
                </>
              ) : (
                <>
                  <Button variant="primary" size="xl" icon={RotateCcw} onClick={() => void recorder.resume()}>Reanudar</Button>
                  <HoldButton variant="danger" size="xl" onConfirm={() => void recorder.finish()} aria-label="Mantén pulsado para finalizar">
                    Finalizar
                  </HoldButton>
                </>
              )}
            </div>
            {status === 'paused' && <p className="xs subtle" style={{ textAlign: 'center' }}>Mantén pulsado «Finalizar» para terminar.</p>}
          </>
        )}
      </section>

      {locked && (
        <div className="lock-overlay" role="dialog" aria-label="Controles bloqueados">
          <HoldButton variant="secondary" size="lg" icon={Unlock} onConfirm={() => setLocked(false)}>Mantén para desbloquear</HoldButton>
        </div>
      )}
    </div>
  );
}

