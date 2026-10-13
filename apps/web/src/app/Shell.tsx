import {
  BarChart3, CircleDot, CloudOff, Dumbbell, Home, ListChecks, Moon, Route, Settings, Sun, Download,
} from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useSession } from '../data/session';
import { Avatar, Button, IconButton } from '../ui/primitives';
import { Brand } from './Brand';
import { useOnline, useRecorder } from './hooks';
import { promptInstall, reloadForUpdate, usePwa } from './pwa';
import { useTheme } from './theme';

function Banners() {
  const online = useOnline();
  const rec = useRecorder();
  const { pathname } = useLocation();
  const pwa = usePwa();
  const live = rec.session && ['recording', 'paused', 'finishing', 'error'].includes(rec.session.status) && pathname !== '/grabar';
  return (
    <>
      {live && (
        <div className="banner banner--live" role="status">
          <CircleDot aria-hidden />
          {rec.session!.status === 'recording' ? 'Grabando actividad' : rec.session!.status === 'paused' ? 'Actividad en pausa' : 'Actividad pendiente de guardar'}
          <NavLink to="/grabar">Abrir</NavLink>
        </div>
      )}
      {!online && (
        <div className="banner banner--offline" role="status">
          <CloudOff aria-hidden /> Sin conexión. Trazo funciona igualmente: tus actividades están en este dispositivo.
        </div>
      )}
      {pwa.updateReady && (
        <div className="banner banner--update" role="status">
          <Download aria-hidden /> Hay una nueva versión de Trazo.
          <Button size="sm" variant="primary" onClick={() => void reloadForUpdate()}>Actualizar</Button>
        </div>
      )}
    </>
  );
}

function ThemeToggle() {
  const { theme, setPreference } = useTheme();
  return <IconButton icon={theme === 'dark' ? Sun : Moon} label={theme === 'dark' ? 'Tema claro' : 'Tema oscuro'} onClick={() => setPreference(theme === 'dark' ? 'light' : 'dark')} />;
}

export function Shell() {
  const { session } = useSession();
  const rec = useRecorder();
  const navigate = useNavigate();
  const pwa = usePwa();
  const me = session!.user;
  const live = rec.session && ['recording', 'paused'].includes(rec.session.status);

  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Navegación principal">
        <Brand />
        <Button variant="primary" block className="sidebar__record" icon={CircleDot} onClick={() => navigate('/grabar')}>
          {live ? 'Volver a la grabación' : 'Grabar actividad'}
        </Button>
        <nav className="sidebar__nav">
          <NavLink to="/" end><Home aria-hidden /> Inicio</NavLink>
          <NavLink to="/actividades"><ListChecks aria-hidden /> Actividades</NavLink>
          <NavLink to="/progreso"><BarChart3 aria-hidden /> Progreso</NavLink>
          <NavLink to="/entrenamiento"><Dumbbell aria-hidden /> Entrenamiento</NavLink>
          <NavLink to="/rutas"><Route aria-hidden /> Rutas</NavLink>
          <NavLink to="/ajustes"><Settings aria-hidden /> Ajustes</NavLink>
        </nav>
        <div className="sidebar__foot">
          {pwa.canInstall && <Button size="sm" variant="ghost" icon={Download} onClick={() => void promptInstall()}>Instalar aplicación</Button>}
          <div className="row between" style={{ padding: '0 8px' }}>
            <ThemeToggle />
          </div>
          <NavLink to="/ajustes" className="sidebar__me">
            <Avatar url={me.avatarUrl} name={me.displayName} size="sm" />
            <div className="grow">
              <div className="ellipsis" style={{ fontWeight: 600 }}>{me.displayName}</div>
              <div className="xs subtle ellipsis">Perfil local</div>
            </div>
          </NavLink>
        </div>
      </aside>

      <div className="shell__main">
        <header className="topbar">
          <NavLink to="/" aria-label="Inicio"><Brand /></NavLink>
          <span className="grow" />
          <ThemeToggle />
          <button type="button" className="icon-btn" aria-label="Tu perfil y ajustes" onClick={() => navigate('/ajustes')}>
            <Avatar url={me.avatarUrl} name={me.displayName} size="sm" />
          </button>
        </header>
        <Banners />
        <main id="main">
          <Outlet />
        </main>
        <nav className="bottom-nav" aria-label="Navegación principal">
          <NavLink to="/" end><Home aria-hidden />Inicio</NavLink>
          <NavLink to="/progreso"><BarChart3 aria-hidden />Progreso</NavLink>
          <NavLink to="/grabar" className={['record-fab', live && 'is-live'].filter(Boolean).join(' ')} aria-label="Grabar actividad"><CircleDot aria-hidden /></NavLink>
          <NavLink to="/rutas"><Route aria-hidden />Rutas</NavLink>
          <NavLink to="/ajustes"><Settings aria-hidden />Ajustes</NavLink>
        </nav>
      </div>
    </div>
  );
}
