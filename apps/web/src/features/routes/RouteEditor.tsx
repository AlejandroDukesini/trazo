import {
  GPS_SPORT_KEYS, SPORTS, cumulativeDistance, elevationGainLoss, formatDistance, formatElevation, parseTrackFile, uuidv7, ImportError, type Visibility,
} from '@trazo/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CircleDot, Download, FileUp, MapPin, Search, Star, Trash2, Undo2, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useDocumentTitle, useUnits } from '../../app/hooks';
import { MapView, type Waypoint } from '../../components/MapView';
import { ApiError, api, download } from '../../data/api';
import { useSession } from '../../data/session';
import { useConfirm } from '../../ui/dialog';
import { Button, Chip, Field, IconButton, Input, Notice, Select, Stat, Switch } from '../../ui/primitives';
import { useToast } from '../../ui/toast';

interface RouteFull {
  id: string; ownerId: string; name: string; sport: string; description: string; visibility: Visibility; favorite: boolean; routed: boolean; version: number;
  waypoints: Waypoint[]; geometry: { lat: number[]; lng: number[]; ele: Array<number | null> | null };
}
interface Directions { lat: number[]; lng: number[]; ele: Array<number | null>; distanceM: number | null; ascentM: number | null; attribution: string }
interface Place { name: string; label: string; lat: number; lng: number }

function ElevationProfile({ dist, ele }: { dist: Float64Array; ele: Array<number | null> }) {
  const d = useMemo(() => {
    const pts = ele.map((e, i) => (e == null ? null : [dist[i]!, e] as const)).filter(Boolean) as Array<readonly [number, number]>;
    if (pts.length < 2) return null;
    const maxD = pts.at(-1)![0], minE = Math.min(...pts.map((p) => p[1])), maxE = Math.max(...pts.map((p) => p[1]));
    const h = Math.max(maxE - minE, 20);
    const path = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${((x / maxD) * 400).toFixed(1)} ${(90 - ((y - minE) / h) * 80).toFixed(1)}`).join('');
    return { path: `${path}L400 90L0 90Z`, minE, maxE };
  }, [dist, ele]);
  if (!d) return <p className="xs subtle">Sin datos de elevación para este trazado.</p>;
  return (
    <figure className="stack" style={{ ['--gap' as string]: '4px', margin: 0 }}>
      <svg className="elev-profile" viewBox="0 0 400 90" preserveAspectRatio="none" role="img" aria-label={`Perfil de elevación entre ${Math.round(d.minE)} y ${Math.round(d.maxE)} m`}>
        <path className="area" d={d.path} />
      </svg>
      <figcaption className="row between xs subtle"><span>{Math.round(d.minE)} m</span><span>{Math.round(d.maxE)} m</span></figcaption>
    </figure>
  );
}

export default function RouteEditor() {
  const { id: param = 'nueva' } = useParams();
  const isNew = param === 'nueva';
  const [id] = useState(() => (isNew ? uuidv7() : param));
  const units = useUnits();
  const { can, session } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const existing = useQuery({ queryKey: ['route', id], enabled: !isNew, queryFn: () => api<RouteFull>(`/routes/${id}`) });
  const caps = useQuery({ queryKey: ['geo-caps'], queryFn: () => api<{ routing: boolean }>('/geo/capabilities'), staleTime: Infinity });
  const [name, setName] = useState('');
  const [sport, setSport] = useState('run');
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [favorite, setFavorite] = useState(false);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [history, setHistory] = useState<Waypoint[][]>([]);
  const [geometry, setGeometry] = useState<{ lat: number[]; lng: number[]; ele: Array<number | null> | null } | null>(null);
  const [routed, setRouted] = useState(false);
  const [autoRoute, setAutoRoute] = useState(false);
  const [routing, setRouting] = useState(false);
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [center, setCenter] = useState<{ lat: number; lng: number; key: number } | null>(null);
  const [version, setVersion] = useState<number | undefined>(undefined);
  const canRoute = can('routes.autoRouting') && !!caps.data?.routing;
  const readOnly = !!existing.data && existing.data.ownerId !== session?.user.id;
  useDocumentTitle(name || 'Nueva ruta');

  useEffect(() => {
    const r = existing.data;
    if (!r) return;
    setName(r.name); setSport(r.sport); setVisibility(r.visibility); setFavorite(r.favorite);
    setWaypoints(r.waypoints); setGeometry(r.geometry); setRouted(r.routed); setVersion(r.version);
  }, [existing.data]);

  // Centra en la ubicación actual al crear una ruta nueva.
  useEffect(() => {
    if (!isNew || !('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition((p) => setCenter({ lat: p.coords.latitude, lng: p.coords.longitude, key: Date.now() }), () => undefined, { timeout: 8000, maximumAge: 600_000 });
  }, [isNew]);

  // Recalcula la geometría al cambiar los puntos.
  useEffect(() => {
    if (readOnly) return;
    if (waypoints.length < 2) { if (!routed || waypoints.length === 0) setGeometry(waypoints.length ? { lat: waypoints.map((w) => w.lat), lng: waypoints.map((w) => w.lng), ele: null } : null); return; }
    if (!autoRoute || !canRoute) {
      if (routed && existing.data && waypoints === existing.data.waypoints) return; // conserva geometría importada/ruteada
      setRouted(false);
      setGeometry({ lat: waypoints.map((w) => w.lat), lng: waypoints.map((w) => w.lng), ele: null });
      return;
    }
    let cancelled = false;
    setRouting(true);
    api<Directions>('/geo/directions', { method: 'POST', body: { sport, waypoints } })
      .then((d) => { if (!cancelled) { setGeometry({ lat: d.lat, lng: d.lng, ele: d.ele }); setRouted(true); } })
      .catch((err) => {
        if (cancelled) return;
        toast.show(err instanceof ApiError ? err.message : 'No se pudo calcular la ruta', { tone: 'danger' });
        setGeometry({ lat: waypoints.map((w) => w.lat), lng: waypoints.map((w) => w.lng), ele: null });
        setRouted(false);
      })
      .finally(() => { if (!cancelled) setRouting(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waypoints, autoRoute, sport]);

  const dist = useMemo(() => (geometry ? cumulativeDistance({ lat: geometry.lat, lng: geometry.lng }) : new Float64Array()), [geometry]);
  const total = dist.length ? dist[dist.length - 1]! : 0;
  const elev = geometry?.ele ? elevationGainLoss(geometry.ele, 2) : null;
  const tracks = useMemo(() => (geometry && geometry.lat.length > 1 ? [{ id: 'route', lat: geometry.lat, lng: geometry.lng }] : []), [geometry]);

  const update = (next: Waypoint[]) => { setHistory((h) => [...h.slice(-30), waypoints]); setWaypoints(next); };

  const search = async () => {
    if (query.trim().length < 2) return;
    try {
      setPlaces(await api<Place[]>(`/geo/search?q=${encodeURIComponent(query)}${center ? `&lat=${center.lat}&lng=${center.lng}` : ''}`));
    } catch (err) {
      toast.error(err);
    }
  };

  const importGpx = async (file: File) => {
    try {
      const parsed = parseTrackFile(file.name, await file.text());
      const lat = parsed.points.map((p) => p.lat), lng = parsed.points.map((p) => p.lng), ele = parsed.points.map((p) => p.ele);
      if (lat.length > 50_000) throw new ImportError('La ruta tiene demasiados puntos (máx. 50 000).');
      setName((n) => n || parsed.name || file.name.replace(/\.\w+$/, ''));
      if (parsed.sport) setSport(parsed.sport);
      setAutoRoute(false);
      setRouted(true);
      setGeometry({ lat, lng, ele: ele.some((e) => e != null) ? ele : null });
      setWaypoints([{ lat: lat[0]!, lng: lng[0]! }, { lat: lat.at(-1)!, lng: lng.at(-1)! }]);
      setCenter(null);
    } catch (err) {
      toast.show(err instanceof ImportError ? err.message : 'No se pudo leer el archivo', { tone: 'danger' });
    }
  };

  const save = useMutation({
    mutationFn: () => api<RouteFull>(`/routes/${id}`, {
      method: 'PUT',
      body: { id, name: name.trim() || 'Ruta sin nombre', sport, visibility, favorite, routed, waypoints, geometry: { lat: geometry!.lat, lng: geometry!.lng, ...(geometry!.ele ? { ele: geometry!.ele } : {}) }, baseVersion: version },
    }),
    onSuccess: (r) => {
      setVersion(r.version);
      void qc.invalidateQueries({ queryKey: ['routes'] });
      qc.setQueryData(['route', id], r);
      toast.show('Ruta guardada', { tone: 'success' });
      if (isNew) navigate(`/rutas/${id}`, { replace: true });
    },
    onError: toast.error,
  });

  const remove = async () => {
    if (!(await confirm({ title: 'Eliminar ruta', message: 'La ruta se eliminará de forma permanente.', confirmLabel: 'Eliminar', danger: true }))) return;
    await api(`/routes/${id}`, { method: 'DELETE' });
    void qc.invalidateQueries({ queryKey: ['routes'] });
    navigate('/rutas', { replace: true });
  };

  return (
    <div className="page page--wide stack">
      <div className="row between wrap">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => navigate('/rutas')}>Rutas</Button>
        {!isNew && !readOnly && (
          <div className="row">
            <IconButton icon={Download} label="Exportar GPX" onClick={() => void download(`/routes/${id}/export`, 'ruta.gpx').catch(toast.error)} />
            <IconButton icon={Trash2} label="Eliminar ruta" onClick={remove} />
          </div>
        )}
      </div>
      <div className="route-editor">
        <div className="stack">
          <MapView
            tracks={tracks}
            waypoints={readOnly ? undefined : waypoints}
            onMapClick={readOnly ? undefined : (p) => update([...waypoints, p])}
            onWaypointDrag={readOnly ? undefined : (i, p) => update(waypoints.map((w, k) => (k === i ? p : w)))}
            onWaypointClick={readOnly ? undefined : (i) => update(waypoints.filter((_, k) => k !== i))}
            fitKey={existing.data?.id ?? (geometry && routed && !autoRoute ? geometry.lat.length : undefined)}
            center={center}
            label="Mapa del editor de rutas"
          />
          {!readOnly && <p className="xs subtle">Toca el mapa para añadir puntos. Arrastra un punto para moverlo; tócalo para quitarlo.</p>}
        </div>
        <aside className="card card--pad stack">
          <div className="stats-row">
            <Stat label="Distancia" value={formatDistance(total, units)} />
            <Stat label="Desnivel +" value={elev?.gain != null ? formatElevation(elev.gain, units) : '–'} note={elev?.gain != null ? 'Estimado' : undefined} />
          </div>
          {geometry?.ele ? <ElevationProfile dist={dist} ele={geometry.ele} /> : <p className="xs subtle">El perfil de elevación está disponible con rutas por caminos o archivos GPX con altitud.</p>}
          {!readOnly && (
            <>
              <div className="row">
                <Input aria-label="Buscar lugar" placeholder="Buscar lugar" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void search(); }} />
                <IconButton icon={Search} label="Buscar" onClick={() => void search()} />
              </div>
              {places.length > 0 && (
                <div className="list card card--flat">
                  {places.map((p) => (
                    <button key={`${p.lat},${p.lng}`} type="button" className="list-item" onClick={() => { setCenter({ lat: p.lat, lng: p.lng, key: Date.now() }); setPlaces([]); }}>
                      <MapPin width={16} /> <span className="grow ellipsis small">{p.label}</span>
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); update([...waypoints, { lat: p.lat, lng: p.lng }]); setPlaces([]); }}>Añadir</Button>
                    </button>
                  ))}
                </div>
              )}
              <Switch checked={autoRoute && canRoute} disabled={!canRoute} onChange={setAutoRoute} label={<span className="row" style={{ ['--gap' as string]: '6px' }}><Wand2 width={16} /> Seguir caminos {routing && <span className="spinner" style={{ width: 14, height: 14 }} />} {!can('routes.autoRouting') && <Chip tone="plus">Plus</Chip>}</span>} />
              {can('routes.autoRouting') && caps.data && !caps.data.routing && <p className="xs subtle">El cálculo por caminos no está configurado en este servidor.</p>}
              <div className="row wrap">
                <Button size="sm" icon={Undo2} disabled={!history.length} onClick={() => { setWaypoints(history.at(-1)!); setHistory((h) => h.slice(0, -1)); }}>Deshacer</Button>
                <Button size="sm" icon={FileUp} onClick={() => fileInput.current?.click()}>Importar GPX</Button>
                <input ref={fileInput} type="file" accept=".gpx,.tcx" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importGpx(f); e.target.value = ''; }} />
                {waypoints.length > 0 && <Button size="sm" variant="danger-ghost" onClick={() => update([])}>Borrar puntos</Button>}
              </div>
              <hr className="divider" />
              <Field label="Nombre">{(fid) => <Input id={fid} value={name} maxLength={120} placeholder="Mi ruta" onChange={(e) => setName(e.target.value)} />}</Field>
              <div className="form-grid form-grid--2">
                <Field label="Deporte">{(fid) => <Select id={fid} value={sport} onChange={(e) => setSport(e.target.value)}>{GPS_SPORT_KEYS.map((k) => <option key={k} value={k}>{SPORTS[k]!.label}</option>)}</Select>}</Field>
                <Field label="Visibilidad">{(fid) => <Select id={fid} value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}><option value="private">Solo yo</option><option value="followers">Seguidores</option><option value="public">Todo el mundo</option></Select>}</Field>
              </div>
              <Switch checked={favorite} onChange={setFavorite} label={<span className="row" style={{ ['--gap' as string]: '6px' }}><Star width={16} /> Favorita</span>} />
              <Button variant="primary" loading={save.isPending} disabled={!geometry || geometry.lat.length < 2} onClick={() => save.mutate()}>Guardar ruta</Button>
            </>
          )}
          {!isNew && (
            <Button icon={CircleDot} disabled={!can('routes.navigation')} onClick={() => navigate(`/grabar?ruta=${id}`)}>
              Seguir en una actividad {!can('routes.navigation') && <Chip tone="plus">Plus</Chip>}
            </Button>
          )}
          {routed && autoRoute && <p className="xs subtle">Rutas: © openrouteservice.org · © colaboradores de OpenStreetMap</p>}
          {readOnly && <Notice icon={MapPin}>Ruta de otra persona (solo lectura).</Notice>}
        </aside>
      </div>
    </div>
  );
}
