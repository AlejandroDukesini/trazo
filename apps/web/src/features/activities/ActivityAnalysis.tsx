import { formatDistance, formatDuration, formatSportSpeed, getSport, type Units } from '@trazo/core';
import { useQuery } from '@tanstack/react-query';
import { Award, HeartPulse, Lock, Medal } from 'lucide-react';
import { Link } from 'react-router';
import { api } from '../../data/api';
import type { ActivityDTO } from '../../data/types';
import { useSession } from '../../data/session';
import { Chip, Empty, Notice } from '../../ui/primitives';
import { PlusLock } from '../settings/PlusLock';

export function Splits({ a, units }: { a: ActivityDTO; units: Units }) {
  const splits = units === 'imperial' ? a.stats.splitsImperial : a.stats.splits;
  if (!splits?.length) return null;
  const fastest = Math.min(...splits.filter((s) => s.distanceM > 100).map((s) => s.movingS / s.distanceM));
  return (
    <section className="card" aria-labelledby="splits">
      <div className="card__head"><h2 id="splits" className="section-title">Parciales</h2></div>
      <div className="card__body table-wrap">
        <table className="table splits">
          <thead><tr><th>{units === 'imperial' ? 'Milla' : 'Km'}</th><th>{getSport(a.sport).display === 'pace' ? 'Ritmo' : 'Velocidad'}</th><th style={{ width: '40%' }} /><th className="right">Desnivel</th>{splits.some((s) => s.avgHr) && <th className="right">FC</th>}</tr></thead>
          <tbody>
            {splits.map((s) => {
              const speed = s.movingS > 0 ? s.distanceM / s.movingS : 0;
              const rel = speed > 0 ? fastest / (s.movingS / s.distanceM) : 0;
              return (
                <tr key={s.index}>
                  <td>{s.distanceM < (units === 'imperial' ? 1600 : 990) ? (s.distanceM / (units === 'imperial' ? 1609.344 : 1000)).toFixed(2) : s.index}</td>
                  <td>{formatSportSpeed(a.sport, speed, units)}</td>
                  <td><div className="bar" style={{ width: `${Math.max(8, Math.min(100, rel * 100))}%` }} /></td>
                  <td className="right">{s.elevDiffM != null ? `${s.elevDiffM > 0 ? '+' : ''}${Math.round(s.elevDiffM)} m` : '–'}</td>
                  {splits.some((x) => x.avgHr) && <td className="right">{s.avgHr ?? '–'}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Laps({ a, units }: { a: ActivityDTO; units: Units }) {
  if (!a.stats.laps?.length) return null;
  return (
    <section className="card" aria-labelledby="laps">
      <div className="card__head"><h2 id="laps" className="section-title">Vueltas</h2></div>
      <div className="card__body table-wrap">
        <table className="table">
          <thead><tr><th>#</th><th className="right">Distancia</th><th className="right">Tiempo</th><th className="right">{getSport(a.sport).display === 'pace' ? 'Ritmo' : 'Velocidad'}</th><th className="right">FC</th></tr></thead>
          <tbody>
            {a.stats.laps.map((l) => (
              <tr key={l.index}>
                <td>{l.index}</td>
                <td className="right">{formatDistance(l.distanceM, units)}</td>
                <td className="right">{formatDuration(l.elapsedS)}</td>
                <td className="right">{formatSportSpeed(a.sport, l.movingS > 0 ? l.distanceM / l.movingS : 0, units)}</td>
                <td className="right">{l.avgHr ?? '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function BestEfforts({ a }: { a: ActivityDTO }) {
  if (!a.stats.bestEfforts?.length) return null;
  return (
    <section className="card" aria-labelledby="be">
      <div className="card__head"><h2 id="be" className="section-title">Mejores esfuerzos</h2></div>
      <div className="list">
        {a.stats.bestEfforts.map((e) => (
          <div key={e.distanceM} className="list-item">
            <span className="list-item__icon"><Medal aria-hidden /></span>
            <span className="grow">{e.label}</span>
            <strong className="num">{formatDuration(e.elapsedS)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

interface Effort { id: string; segmentId: string; name: string; elapsedS: number; distanceM: number; flagged: boolean; isPersonalBest: boolean }

export function SegmentEfforts({ a, synced }: { a: ActivityDTO; synced: boolean }) {
  const q = useQuery({ queryKey: ['efforts', a.id], queryFn: () => api<Effort[]>(`/activities/${a.id}/efforts`), enabled: synced && a.hasStream });
  if (!synced || !a.hasStream) return null;
  if (!q.data?.length) return null;
  return (
    <section className="card" aria-labelledby="segs">
      <div className="card__head"><h2 id="segs" className="section-title">Segmentos</h2></div>
      <div className="list">
        {q.data.map((e) => (
          <Link key={e.id} to={`/segmentos/${e.segmentId}`} className="list-item">
            <span className="list-item__icon"><Award aria-hidden /></span>
            <span className="grow ellipsis">{e.name}</span>
            {e.isPersonalBest && <Chip tone="accent">Récord personal</Chip>}
            {e.flagged && <Chip tone="warning">No válido</Chip>}
            <strong className="num">{formatDuration(e.elapsedS)}</strong>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function HrZones({ a, synced }: { a: ActivityDTO; synced: boolean }) {
  const { can, session } = useSession();
  const isOwner = session?.user.id === a.owner.id;
  const enabled = isOwner && synced && a.avgHr != null && can('training.zones');
  const q = useQuery({ queryKey: ['zones', a.id], queryFn: () => api<{ zones: Array<{ index: number; label: string; min: number; max: number }>; seconds: number[] | null }>(`/activities/${a.id}/zones`), enabled, retry: false });
  if (!isOwner || a.avgHr == null) return null;
  return (
    <section className="card" aria-labelledby="zones">
      <div className="card__head"><h2 id="zones" className="section-title row"><HeartPulse width={16} height={16} /> Zonas de frecuencia cardíaca</h2></div>
      <div className="card__body stack">
        {!can('training.zones') ? (
          <PlusLock feature="training.zones" compact />
        ) : !synced ? (
          <Notice icon={Lock}>Disponible cuando la actividad se sincronice.</Notice>
        ) : q.error ? (
          <Notice icon={HeartPulse} tone="warning">{(q.error as Error).message} <Link className="link" to="/ajustes">Ir al perfil</Link></Notice>
        ) : q.data?.seconds ? (
          q.data.zones.map((z, i) => {
            const total = q.data!.seconds!.reduce((x, y) => x + y, 0) || 1;
            const pct = q.data!.seconds![i]! / total;
            return (
              <div key={z.index} className="stack" style={{ ['--gap' as string]: '4px' }}>
                <div className="row between small"><span>{z.label} <span className="subtle">({z.min}–{z.max})</span></span><span className="num">{formatDuration(q.data!.seconds![i]!)} · {Math.round(pct * 100)} %</span></div>
                <div className="progress"><span style={{ width: `${pct * 100}%`, background: `color-mix(in srgb, var(--data-hr) ${30 + i * 15}%, var(--surface-3))` }} /></div>
              </div>
            );
          })
        ) : (
          <Empty icon={HeartPulse} title="Calculando…" />
        )}
      </div>
    </section>
  );
}
