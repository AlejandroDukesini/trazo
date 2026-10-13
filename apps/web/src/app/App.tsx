import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Component, lazy, Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router';
import { RefreshCw } from 'lucide-react';
import { recorder } from '../data/recorder';
import { SessionProvider, useSession } from '../data/session';
import { ConfirmProvider } from '../ui/dialog';
import { Button, Skeleton } from '../ui/primitives';
import { ToastProvider } from '../ui/toast';
import { BrandMark } from './Brand';
import { Shell } from './Shell';

const Record = lazy(() => import('../features/record/RecordPage'));
const History = lazy(() => import('../features/activities/HistoryPage'));
const ActivityDetail = lazy(() => import('../features/activities/ActivityPage'));
const Import = lazy(() => import('../features/activities/ImportPage'));
const Compare = lazy(() => import('../features/activities/ComparePage'));
const Progress = lazy(() => import('../features/progress/ProgressPage'));
const Training = lazy(() => import('../features/training/TrainingPage'));
const Routes_ = lazy(() => import('../features/routes/RoutesPage'));
const RouteEditor = lazy(() => import('../features/routes/RouteEditor'));
const Segment = lazy(() => import('../features/segments/SegmentPage'));
const Settings = lazy(() => import('../features/settings/SettingsPage'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 30 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Splash() {
  return (
    <div className="splash" aria-busy="true" aria-label="Cargando Trazo">
      <BrandMark />
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="page stack" aria-busy="true" aria-label="Cargando">
      <Skeleton w={220} h={30} />
      <Skeleton h={140} r={18} />
      <Skeleton h={140} r={18} />
    </div>
  );
}

/** Recuperación de errores de renderizado: nunca deja la pantalla en blanco. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error) {
    console.error(error);
  }
  override render() {
    if (!this.state.error) return this.props.children;
    const chunk = /Failed to fetch dynamically imported module|Loading chunk/i.test(this.state.error.message);
    return (
      <div className="splash">
        <div className="stack" style={{ alignItems: 'center', textAlign: 'center', maxWidth: 420, padding: 24 }}>
          <BrandMark />
          <h2>{chunk ? 'Hay una versión nueva' : 'Algo ha fallado'}</h2>
          <p className="muted">
            {chunk ? 'Recarga para usar la última versión de Trazo.' : 'Tus actividades guardadas están a salvo en este dispositivo. Recarga la aplicación para continuar.'}
          </p>
          <Button variant="primary" icon={RefreshCw} onClick={() => window.location.reload()}>Recargar</Button>
        </div>
      </div>
    );
  }
}

/** Espera a que el perfil local esté cargado antes de mostrar la app. */
function Ready({ children }: { children: ReactNode }) {
  const { status } = useSession();
  if (status === 'loading') return <Splash />;
  return <>{children}</>;
}

/** Al arrancar: recupera una grabación interrumpida. */
function RecoveryGate() {
  const { status } = useSession();
  const navigate = useNavigate();
  useEffect(() => {
    if (status !== 'authed') return;
    recorder.recover().then((s) => {
      if (s && (s.status === 'recording' || s.status === 'paused' || s.status === 'finishing')) navigate('/grabar');
    }).catch((e) => console.error('Recuperación de grabación', e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);
  return null;
}

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <ConfirmProvider>
            <SessionProvider>
              <BrowserRouter>
                <RecoveryGate />
                <Ready>
                  <Suspense fallback={<Splash />}>
                    <Routes>
                      <Route path="/grabar" element={<Record />} />
                      <Route element={<Shell />}>
                        <Route index element={<Suspense fallback={<PageSkeleton />}><History /></Suspense>} />
                        <Route path="actividades" element={<Suspense fallback={<PageSkeleton />}><History /></Suspense>} />
                        <Route path="actividades/importar" element={<Suspense fallback={<PageSkeleton />}><Import /></Suspense>} />
                        <Route path="actividades/comparar" element={<Suspense fallback={<PageSkeleton />}><Compare /></Suspense>} />
                        <Route path="actividad/:id" element={<Suspense fallback={<PageSkeleton />}><ActivityDetail /></Suspense>} />
                        <Route path="progreso" element={<Suspense fallback={<PageSkeleton />}><Progress /></Suspense>} />
                        <Route path="entrenamiento" element={<Suspense fallback={<PageSkeleton />}><Training /></Suspense>} />
                        <Route path="rutas" element={<Suspense fallback={<PageSkeleton />}><Routes_ /></Suspense>} />
                        <Route path="rutas/:id" element={<Suspense fallback={<PageSkeleton />}><RouteEditor /></Suspense>} />
                        <Route path="segmentos/:id" element={<Suspense fallback={<PageSkeleton />}><Segment /></Suspense>} />
                        <Route path="ajustes/*" element={<Suspense fallback={<PageSkeleton />}><Settings /></Suspense>} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                      </Route>
                    </Routes>
                  </Suspense>
                </Ready>
              </BrowserRouter>
            </SessionProvider>
          </ConfirmProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
