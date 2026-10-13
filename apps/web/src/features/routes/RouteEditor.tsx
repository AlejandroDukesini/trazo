import {
  GPS_SPORT_KEYS, SPORTS, cumulativeDistance, elevationGainLoss, formatDistance, formatElevation, parseTrackFile, routeToGpx, uuidv7, ImportError,
} from '@trazo/core';
import { ArrowLeft, CircleDot, Download, FileUp, MapPin, Search, Star, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useDocumentTitle, useUnits } from '../../app/hooks';
import { MapView, type Waypoint } from '../../components/MapView';
import { getRoute, saveRoute, deleteRoute } from '../../data/routes-local';
import { searchPlaces, type Place } from '../../data/geo-local';
import { saveFile } from '../../platform/files';
import { useConfirm } from '../../ui/dialog';
import { Button, Field, IconButton, Input, Notice, Select, Stat, Switch } from '../../ui/primitives';
import { useToast } from '../../ui/toast';

type Geometry = { lat: number[]; lng: number[]; ele: Array<number | null> | null };

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
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const fileInput = useRef<HTMLInputElement>(null);

  const [loaded, setLoaded] = useState(isNew);
  const [notFound, setNotFound] = useState(false);
  const [name, setName] = useState('');
  const [sport, setSport] = useState('run');
  const [favorite, setFavorite] = useState(false);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [history, setHistory] = useState<Waypoint[][]>([]);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [imported, setImported] = useState(false);
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [center, setCenter] = useState<{ lat: number; lng: number; key: number } | null>(null);
  const [saving, setSaving] = useState(false);
  useDocumentTitle(name || 'Nueva ruta');

  // Carga una ruta existente.
  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    getRoute(id).then((r) => {
      if (cancelled) return;
      if (!r) { setNotFound(true); setLoaded(true); return; }
      setName(r.name); setSport(r.sport); setFavorite(r.favorite);
      setWaypoints(r.waypoints); setGeometry(r.geometry); setImported(r.waypoints.length < 2 && r.geometry.lat.length > 1);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [id, isNew]);

  // Centra en la ubicación actual al crear una ruta nueva.
  useEffect(() => {
    if (!isNew || !('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition((p) => setCenter({ lat: p.coords.latitude, lng: p.coords.longitude, key: Date.now() }), () => undefined, { timeout: 8000, maximumAge: 600_000 });
  }, [isNew]);

  // Geometría = líneas rectas entre los puntos (trazado manual). Las rutas importadas conservan su traza.
  useEffect(() => {
    if (!loaded || imported) return;
    setGeometry(waypoints.length ? { lat: waypoints.map((w) => w.lat), lng: waypoints.map((w) => w.lng), ele: null } : null);
  }, [waypoints, imported, loaded]);

  const dist = useMemo(() => (geometry ? cumulativeDistance({ lat: geometry.lat, lng: geometry.lng }) : new Float64Array()), [geometry]);
  const total = dist.length ? dist[dist.length - 1]! : 0;
  const elev = geometry?.ele ? elevationGainLoss(geometry.ele, 2) : null;
  const tracks = useMemo(() => (geometry && geometry.lat.length > 1 ? [{ id: 'route', lat: geometry.lat, lng: geometry.lng }] : []), [geometry]);

  const update = (next: Waypoint[]) => { setHistory((h) => [...h.slice(-30), waypoints]); setImported(false); setWaypoints(next); };

  const search = async () => {
    if (query.trim().length < 2) return;
    try {
      setPlaces(await searchPlaces(query, center ?? undefined));
    } catch (err) {
      toast.error(err);
    }
  };

  const importGpx = async (file: File) => {
    try {
      const parsed = parseTrackFile(file.name, await file.text());
      const lat = parsed.points.map((p) => p.lat), lng = parsed.points.map((p) => p.lng), ele = parsed.points.map((p) => p.ele);
      if (lat.length < 2) throw new ImportError('El archivo no contiene un recorrido.');
      if (lat.length > 50_000) throw new ImportError('La ruta tiene demasiados puntos (máx. 50 000).');
      setName((n) => n || parsed.name || file.name.replace(/\.\w+$/, ''));
      if (parsed.sport) setSport(parsed.sport);
      setImported(true);
      setGeometry({ lat, lng, ele: ele.some((e) => e != null) ? ele : null });
      setWaypoints([{ lat: lat[0]!, lng: lng[0]! }, { lat: lat.at(-1)!, lng: lng.at(-1)! }]);
      setCenter(null);
    } catch (err) {
      toast.show(err instanceof ImportError ? err.message : 'No se pudo leer el archivo', { tone: 'danger' });
    }
  };

  const save = async () => {
    if (!geometry || geometry.lat.length < 2) return;
    setSaving(true);
    try {
      await saveRoute({ id, name, sport, favorite, waypoints, geometry });
      toast.show('Ruta guardada', { tone: 'success' });
      if (isNew) navigate(`/rutas/${id}`, { replace: true });
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const exportGpx = async () => {
    if (!geometry) return;
    try {
      const xml = routeToGpx(name || 'Ruta', geometry.lat, geometry.lng, geometry.ele ?? undefined);
      await saveFile(`${(name || 'ruta').replace(/[^\w.-]+/g, '_')}.gpx`, new Blob([xml], { type: 'application/gpx+xml' }));
    } catch (err) {
      toast.error(err);
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Eliminar ruta', message: 'La ruta se eliminará de forma permanente.', confirmLabel: 'Eliminar', danger: true }))) return;
    await deleteRoute(id);
    navigate('/rutas', { replace: true });
  };

  if (notFound) return <div className="page"><Notice icon={MapPin} tone="warning">Esta ruta ya no existe.</Notice></div>;

  return (
    <div className="page page--wide stack">
      <div className="row between wrap">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => navigate('/rutas')}>Rutas</Button>
        {!isNew && (
          <div className="row">
            <IconButton icon={Download} label="Exportar GPX" onClick={() => void exportGpx()} />
            <IconButton icon={Trash2} label="Eliminar ruta" onClick={remove} />
          </div>
        )}
      </div>
      <div className="route-editor">
        <div className="stack">
          <MapView
            tracks={tracks}
            waypoints={waypoints}
            onMapClick={(p) => update([...waypoints, p])}
            onWaypointDrag={(i, p) => update(waypoints.map((w, k) => (k === i ? p : w)))}
            onWaypointClick={(i) => update(waypoints.filter((_, k) => k !== i))}
            fitKey={imported ? geometry?.lat.length : undefined}
            center={center}
            label="Mapa del editor de rutas"
          />
          <p className="xs subtle">Toca el mapa para añadir puntos. Arrastra un punto para moverlo; tócalo para quitarlo.</p>
        </div>
        <aside className="card card--pad stack">
          <div className="stats-row">
            <Stat label="Distancia" value={formatDistance(total, units)} />
            <Stat label="Desnivel +" value={elev?.gain != null ? formatElevation(elev.gain, units) : '–'} note={elev?.gain != null ? 'Estimado' : undefined} />
          </div>
          {geometry?.ele ? <ElevationProfile dist={dist} ele={geometry.ele} /> : <p className="xs subtle">El perfil de elevación está disponible al importar un archivo GPX con altitud.</p>}
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
          <div className="row wrap">
            <Button size="sm" icon={Undo2} disabled={!history.length} onClick={() => { setWaypoints(history.at(-1)!); setHistory((h) => h.slice(0, -1)); }}>Deshacer</Button>
            <Button size="sm" icon={FileUp} onClick={() => fileInput.current?.click()}>Importar GPX</Button>
            <input ref={fileInput} type="file" accept=".gpx,.tcx" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importGpx(f); e.target.value = ''; }} />
            {waypoints.length > 0 && <Button size="sm" variant="danger-ghost" onClick={() => update([])}>Borrar puntos</Button>}
          </div>
          <hr className="divider" />
          <Field label="Nombre">{(fid) => <Input id={fid} value={name} maxLength={120} placeholder="Mi ruta" onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Deporte">{(fid) => <Select id={fid} value={sport} onChange={(e) => setSport(e.target.value)}>{GPS_SPORT_KEYS.map((k) => <option key={k} value={k}>{SPORTS[k]!.label}</option>)}</Select>}</Field>
          <Switch checked={favorite} onChange={setFavorite} label={<span className="row" style={{ ['--gap' as string]: '6px' }}><Star width={16} /> Favorita</span>} />
          <Button variant="primary" loading={saving} disabled={!geometry || geometry.lat.length < 2} onClick={() => void save()}>Guardar ruta</Button>
          {!isNew && (
            <Button icon={CircleDot} onClick={() => navigate(`/grabar?ruta=${id}`)}>Seguir en una actividad</Button>
          )}
        </aside>
      </div>
    </div>
  );
}
