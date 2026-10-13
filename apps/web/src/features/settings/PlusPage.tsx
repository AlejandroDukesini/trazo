import { FEATURES, type Feature } from '@trazo/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, CreditCard, Info, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useDocumentTitle } from '../../app/hooks';
import { formatDate } from '../../components/format';
import { api } from '../../data/api';
import { useSession } from '../../data/session';
import { platform } from '../../platform';
import { Button, Chip, Notice, Segmented, Skeleton } from '../../ui/primitives';
import { useToast } from '../../ui/toast';

interface PlansInfo {
  plans: Array<{ key: string; name: string; tagline: string; features: Feature[]; limits: { activeGoals: number; statsHistoryMonths: number | null; leaderboardRows: number; clubsOwned: number } }>;
  unavailable: Partial<Record<Feature, string>>;
  providers: { stripe: boolean; googlePlay: boolean };
  intervals: { month: boolean; year: boolean };
}
interface SubInfo { subscriptions: Array<{ provider: string; plan: string; status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean }> }

const FREE_INCLUDES = [
  'Grabación GPS ilimitada, también sin conexión',
  'Historial, detalle, mapas y gráficos de cada actividad',
  'Importación y exportación GPX/TCX',
  'Récords personales y parciales',
  'Feed, seguidores, comentarios y ánimos',
  'Clubes y retos',
  'Rutas dibujadas a mano y segmentos',
  'Zonas privadas y control de visibilidad',
];

export default function PlusPage() {
  useDocumentTitle('Trazo Plus');
  const { session, refresh } = useSession();
  const toast = useToast();
  const [params] = useSearchParams();
  const [interval, setInterval] = useState<'month' | 'year'>('year');
  const info = useQuery({ queryKey: ['billing-plans'], queryFn: () => api<PlansInfo>('/billing/plans') });
  const sub = useQuery({ queryKey: ['billing-sub'], queryFn: () => api<SubInfo>('/billing/subscription') });
  const isPlus = session?.entitlements.plan === 'plus';
  const estado = params.get('estado');

  // Tras volver de la pasarela, el acceso llega por webhook: se refresca la sesión unos segundos.
  useEffect(() => {
    if (estado !== 'procesando' || isPlus) return;
    let n = 0;
    const t = window.setInterval(() => { n++; void refresh(); void sub.refetch(); if (n > 10) window.clearInterval(t); }, 3000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado, isPlus]);

  const checkout = useMutation({
    mutationFn: () => api<{ url: string }>('/billing/checkout', { method: 'POST', body: { interval } }),
    onSuccess: (r) => { window.location.assign(r.url); },
    onError: toast.error,
  });
  const portal = useMutation({ mutationFn: () => api<{ url: string }>('/billing/portal', { method: 'POST' }), onSuccess: (r) => window.location.assign(r.url), onError: toast.error });

  const plus = info.data?.plans.find((p) => p.key === 'plus');
  const active = sub.data?.subscriptions.find((s) => s.status === 'active' || s.status === 'trialing');
  const canBuyHere = platform !== 'android'; // En Android las compras digitales deben pasar por Google Play.

  return (
    <div className="page stack" style={{ ['--gap' as string]: '20px', maxWidth: 960 }}>
      <section className="card card--pad plus-hero stack">
        <Chip tone="plus" icon={Sparkles}>Trazo Plus</Chip>
        <h1>Entrena con más contexto</h1>
        <p className="muted" style={{ maxWidth: '60ch' }}>Lo esencial es gratis para siempre. Plus añade análisis de carga y forma, planes de entrenamiento, comparativas, clasificaciones completas y rutas por caminos.</p>
        {estado === 'procesando' && !isPlus && <Notice icon={Info} tone="accent">Estamos confirmando el pago con el proveedor. El acceso se activa en cuanto llegue la confirmación.</Notice>}
        {estado === 'cancelado' && <Notice icon={Info}>Pago cancelado. No se ha realizado ningún cargo.</Notice>}
      </section>
      {info.isPending ? <Skeleton h={300} r={18} /> : (
        <div className="plan-grid">
          <div className="card card--pad stack plan-card">
            <h2>Gratis</h2>
            <p className="small muted">Todo lo esencial para registrar y compartir.</p>
            <ul className="check-list">{FREE_INCLUDES.map((t) => <li key={t}><Check aria-hidden />{t}</li>)}</ul>
            {!isPlus && <Chip>Tu plan actual</Chip>}
          </div>
          <div className="card card--pad stack plan-card is-plus">
            <h2 className="row" style={{ ['--gap' as string]: '8px' }}><Sparkles style={{ color: 'var(--accent-strong)' }} /> {plus?.name ?? 'Plus'}</h2>
            <p className="small muted">{plus?.tagline}</p>
            <ul className="check-list">
              <li><Check aria-hidden />Todo lo del plan gratuito</li>
              {plus?.features.map((f) => (
                <li key={f}><Check aria-hidden />{FEATURES[f]}{info.data?.unavailable[f] && <span className="xs subtle"> (próximamente)</span>}</li>
              ))}
              <li><Check aria-hidden />Hasta {plus?.limits.activeGoals} objetivos y {plus?.limits.clubsOwned} clubes propios</li>
            </ul>
            {isPlus ? (
              <div className="stack">
                <Chip tone="accent">Activo{active?.currentPeriodEnd ? ` · ${active.cancelAtPeriodEnd ? 'finaliza' : 'se renueva'} el ${formatDate(active.currentPeriodEnd)}` : ''}</Chip>
                {active?.provider === 'stripe' && <Button icon={CreditCard} loading={portal.isPending} onClick={() => portal.mutate()}>Gestionar suscripción</Button>}
              </div>
            ) : !canBuyHere ? (
              <Notice icon={Info}>La suscripción desde Android se ofrecerá mediante Google Play cuando esté disponible. Si ya te suscribiste en la web, tu acceso funciona aquí con la misma cuenta.</Notice>
            ) : info.data?.providers.stripe ? (
              <div className="stack">
                <Segmented label="Periodo de facturación" value={interval} onChange={setInterval} options={[...(info.data.intervals.month ? [{ value: 'month' as const, label: 'Mensual' }] : []), ...(info.data.intervals.year ? [{ value: 'year' as const, label: 'Anual' }] : [])]} />
                <Button variant="primary" size="lg" icon={CreditCard} loading={checkout.isPending} onClick={() => checkout.mutate()}>Suscribirme</Button>
                <p className="xs subtle">El precio final, con impuestos, se muestra en la pasarela de pago segura antes de confirmar. Puedes cancelar cuando quieras.</p>
              </div>
            ) : (
              <Notice icon={Info}>Las suscripciones todavía no están disponibles en este servidor.</Notice>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
