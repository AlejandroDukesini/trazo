import { SPORTS, SPORT_KEYS, formatDistance, formatDuration, formatElevation, formatSportSpeed } from '@trazo/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, CloudOff, FileUp, GitCompare, ListChecks, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useDocumentTitle, useIsDesktop, useUnits } from '../../app/hooks';
import { ActivityCard } from '../../components/ActivityCard';
import { useSentinel } from '../../components/hooks';
import { formatDate } from '../../components/format';
import { userDb } from '../../data/db';
import type { LocalActivity } from '../../data/types';
import { useSession } from '../../data/session';
import { Button, Chip, Empty, Input, Select, Skeleton } from '../../ui/primitives';
import { SportIcon } from '../../ui/SportIcon';

const PAGE = 40;

export default function HistoryPage() {
  useDocumentTitle('Actividades');
  const units = useUnits();
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const sport = params.get('deporte') ?? '';
  const range = params.get('periodo') ?? '';
  const length = params.get('distancia') ?? '';
  const state = params.get('estado') ?? '';
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<string[]>([]);

  const all = useLiveQuery(() => userDb().activities.orderBy('startedAt').reverse().toArray(), []);

  const filtered = useMemo(() => {
    if (!all) return [];
    const needle = q.trim().toLowerCase();
    const since = range ? Date.now() - Number(range) * 86_400_000 : 0;
    const [minD, maxD] = length ? length.split('-').map(Number) : [0, Infinity];
    return all.filter((a) =>
      !a.deleted &&
      (!sport || a.sport === sport) &&
      (!since || Date.parse(a.startedAt) >= since) &&
      a.distanceM >= (minD ?? 0) * 1000 && a.distanceM < (maxD ?? Infinity) * 1000 &&
      (!state || (state === 'error' ? a.syncState === 'error' || a.syncState === 'conflict' : a.syncState === state)) &&
      (!needle || a.name.toLowerCase().includes(needle) || a.description.toLowerCase().includes(needle)),
    );
  }, [all, q, sport, range, length, state]);

  const shown = filtered.slice(0, limit);
  const sentinel = useSentinel(() => setLimit((l) => l + PAGE), filtered.length > limit);
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
    setLimit(PAGE);
  };
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s.slice(-1), id]));
  const totals = filtered.reduce((acc, a) => ({ d: acc.d + a.distanceM, t: acc.t + a.movingS }), { d: 0, t: 0 });

  return (
    <div className="page page--wide">
      <div className="page__head">
        <div>
          <h1>Actividades</h1>
          <p className="num">{filtered.length} actividades · {formatDistance(totals.d, units, 0)} · {formatDuration(totals.t, { compact: true })}</p>
        </div>
        <div className="row wrap">
          {selected.length === 2 && (
            <Button icon={GitCompare} onClick={() => navigate(`/actividades/comparar?a=${selected[0]}&b=${selected[1]}`)}>
              Comparar {!can('activities.compare') && <Chip tone="plus">Plus</Chip>}
            </Button>
          )}
          <Button icon={FileUp} onClick={() => navigate('/actividades/importar')}>Importar o añadir</Button>
        </div>
      </div>

      <div className="filters" role="search" style={{ marginBottom: 16 }}>
        <div className="search row" style={{ ['--gap' as string]: '0' }}>
          <Input aria-label="Buscar por nombre" placeholder="Buscar por nombre o descripción" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} />
        </div>
        <Select aria-label="Deporte" value={sport} onChange={(e) => setParam('deporte', e.target.value)}>
          <option value="">Todos los deportes</option>
          {SPORT_KEYS.map((k) => <option key={k} value={k}>{SPORTS[k]!.label}</option>)}
        </Select>
        <Select aria-label="Periodo" value={range} onChange={(e) => setParam('periodo', e.target.value)}>
          <option value="">Siempre</option>
          <option value="7">Últimos 7 días</option>
          <option value="30">Últimos 30 días</option>
          <option value="90">Últimos 3 meses</option>
          <option value="365">Último año</option>
        </Select>
        <Select aria-label="Distancia" value={length} onChange={(e) => setParam('distancia', e.target.value)}>
          <option value="">Cualquier distancia</option>
          <option value="0-5">Menos de 5 km</option>
          <option value="5-10">5–10 km</option>
          <option value="10-21">10–21 km</option>
          <option value="21-50">21–50 km</option>
          <option value="50-100000">Más de 50 km</option>
        </Select>
        {state && <Button size="sm" variant="ghost" onClick={() => setParam('estado', '')}>Quitar filtro de estado</Button>}
      </div>

      {!all && <div className="stack"><Skeleton h={64} /><Skeleton h={64} /><Skeleton h={64} /></div>}
      {all && filtered.length === 0 && (
        <div className="card">
          <Empty icon={all.length ? Search : ListChecks} title={all.length ? 'Sin resultados' : 'Aún no hay actividades'} action={!all.length && <Button variant="primary" icon={Plus} onClick={() => navigate('/grabar')}>Grabar actividad</Button>}>
            {all.length ? 'Prueba con otros filtros.' : 'Graba una actividad, impórtala desde un archivo GPX/TCX o añádela manualmente.'}
          </Empty>
        </div>
      )}

      {desktop && shown.length > 0 && (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 36 }}><span className="visually-hidden">Seleccionar para comparar</span></th>
                <th>Fecha</th><th>Actividad</th><th className="right">Distancia</th><th className="right">Tiempo</th><th className="right">Ritmo / vel.</th><th className="right">Desnivel</th><th />
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => <Row key={a.id} a={a} units={units} selected={selected.includes(a.id)} onToggle={() => toggle(a.id)} />)}
            </tbody>
          </table>
        </div>
      )}
      {!desktop && <div className="feed">{shown.map((a) => <ActivityCard key={a.id} a={a} showOwner={false} />)}</div>}
      <div ref={sentinel} />
    </div>
  );
}

function SyncBadge({ a }: { a: LocalActivity }) {
  if (a.syncState === 'synced') return null;
  if (a.syncState === 'pending') return <span title="Pendiente de sincronizar"><CloudOff width={16} height={16} className="subtle" /></span>;
  return <span title={a.lastError ?? 'Conflicto'} style={{ color: 'var(--danger)' }}><AlertTriangle width={16} height={16} /></span>;
}

function Row({ a, units, selected, onToggle }: { a: LocalActivity; units: 'metric' | 'imperial'; selected: boolean; onToggle: () => void }) {
  return (
    <tr>
      <td><input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Seleccionar ${a.name} para comparar`} /></td>
      <td className="muted">{formatDate(a.startedAt)}</td>
      <td>
        <Link to={`/actividad/${a.id}`} className="row" style={{ ['--gap' as string]: '8px', fontWeight: 600 }}>
          <SportIcon sport={a.sport} size={16} /> <span className="ellipsis" style={{ maxWidth: 340 }}>{a.name}</span>
        </Link>
      </td>
      <td className="right">{a.distanceM > 0 ? formatDistance(a.distanceM, units) : '–'}</td>
      <td className="right">{formatDuration(a.movingS)}</td>
      <td className="right">{a.distanceM > 0 ? formatSportSpeed(a.sport, a.avgSpeed, units) : '–'}</td>
      <td className="right">{formatElevation(a.elevGainM, units)}</td>
      <td><SyncBadge a={a} /></td>
    </tr>
  );
}
