import { type ProfilePatch, type Visibility } from '@trazo/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Camera, Download, LogOut, MapPinOff, Monitor, Moon, Shield, Smartphone, Sparkles, Sun, Trash2, UserX, Info,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useDocumentTitle } from '../../app/hooks';
import { promptInstall, usePwa } from '../../app/pwa';
import { useTheme, type ThemePref } from '../../app/theme';
import { MapView } from '../../components/MapView';
import { relativeDate } from '../../components/format';
import { api, download, mediaUrl } from '../../data/api';
import type { Me, UserCard } from '../../data/types';
import { useSession } from '../../data/session';
import { platform } from '../../platform';
import { Dialog, useConfirm } from '../../ui/dialog';
import { Avatar, Button, Chip, Field, Input, Notice, Segmented, Select, Switch, Textarea } from '../../ui/primitives';
import { useToast } from '../../ui/toast';

function Section({ id, title, children, description }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="card card--pad stack" id={id} aria-labelledby={`${id}-t`}>
      <div><h2 id={`${id}-t`}>{title}</h2>{description && <p className="small muted">{description}</p>}</div>
      {children}
    </section>
  );
}

function ProfileSection() {
  const { session, setMe } = useSession();
  const me = session!.user;
  const toast = useToast();
  const avatarInput = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({ displayName: me.displayName, bio: me.bio, location: me.location });
  const save = useMutation({ mutationFn: (p: ProfilePatch) => api<Me>('/me', { method: 'PATCH', body: p }), onSuccess: (m) => { setMe(m); toast.show('Perfil actualizado', { tone: 'success' }); }, onError: toast.error });
  const avatar = useMutation({
    mutationFn: (file: File | null) => {
      if (!file) return api<Me>('/me/avatar', { method: 'DELETE' });
      const fd = new FormData();
      fd.append('file', file);
      return api<Me>('/me/avatar', { method: 'POST', body: fd });
    },
    onSuccess: setMe,
    onError: toast.error,
  });
  return (
    <Section id="perfil" title="Perfil">
      <div className="row">
        <Avatar url={mediaUrl(me.avatarUrl)} name={me.displayName} size="lg" />
        <div className="row wrap">
          <Button size="sm" icon={Camera} loading={avatar.isPending} onClick={() => avatarInput.current?.click()}>Cambiar foto</Button>
          {me.avatarUrl && <Button size="sm" variant="ghost" onClick={() => avatar.mutate(null)}>Quitar</Button>}
          <input ref={avatarInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f0 = e.target.files?.[0]; if (f0) avatar.mutate(f0); e.target.value = ''; }} />
        </div>
      </div>
      <div className="form-grid form-grid--2">
        <Field label="Nombre">{(id) => <Input id={id} value={f.displayName} maxLength={60} onChange={(e) => setF({ ...f, displayName: e.target.value })} />}</Field>
        <Field label="Ubicación">{(id) => <Input id={id} value={f.location} maxLength={80} placeholder="Ciudad" onChange={(e) => setF({ ...f, location: e.target.value })} />}</Field>
      </div>
      <Field label="Biografía">{(id) => <Textarea id={id} value={f.bio} maxLength={500} onChange={(e) => setF({ ...f, bio: e.target.value })} />}</Field>
      <div className="row between wrap">
        <span className="small muted">@{me.username} · {me.email}</span>
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(f)}>Guardar perfil</Button>
      </div>
    </Section>
  );
}

function PreferencesSection() {
  const { session, setMe } = useSession();
  const me = session!.user;
  const toast = useToast();
  const { preference, setPreference } = useTheme();
  const [phys, setPhys] = useState({ weightKg: me.weightKg?.toString() ?? '', hrMax: me.hrMax?.toString() ?? '', hrRest: me.hrRest?.toString() ?? '', ftp: me.ftp?.toString() ?? '' });
  const patch = useMutation({ mutationFn: (p: ProfilePatch) => api<Me>('/me', { method: 'PATCH', body: p }), onSuccess: setMe, onError: toast.error });
  const num = (v: string) => (v.trim() ? Number(v) : null);
  return (
    <Section id="preferencias" title="Preferencias">
      <div className="field">
        <span className="field__label">Tema</span>
        <Segmented<ThemePref> label="Tema" value={preference} onChange={setPreference} options={[{ value: 'system', label: 'Sistema', icon: Monitor }, { value: 'light', label: 'Claro', icon: Sun }, { value: 'dark', label: 'Oscuro', icon: Moon }]} />
      </div>
      <div className="form-grid form-grid--2">
        <Field label="Unidades">{(id) => <Select id={id} value={me.units} onChange={(e) => patch.mutate({ units: e.target.value as 'metric' | 'imperial' })}><option value="metric">Métricas (km, m)</option><option value="imperial">Imperiales (mi, ft)</option></Select>}</Field>
        <Field label="Visibilidad por defecto">{(id) => <Select id={id} value={me.defaultVisibility} onChange={(e) => patch.mutate({ defaultVisibility: e.target.value as Visibility })}><option value="public">Todo el mundo</option><option value="followers">Seguidores</option><option value="private">Solo yo</option></Select>}</Field>
      </div>
      <hr className="divider" />
      <div>
        <h3>Datos fisiológicos</h3>
        <p className="small muted">Opcionales. Se usan para estimar calorías (peso) y calcular zonas y carga (FC máxima). No se comparten con nadie.</p>
      </div>
      <div className="form-grid form-grid--2">
        <Field label="Peso (kg)">{(id) => <Input id={id} type="number" min={25} max={300} value={phys.weightKg} onChange={(e) => setPhys({ ...phys, weightKg: e.target.value })} />}</Field>
        <Field label="FC máxima (ppm)" hint="Mejor si procede de una prueba real.">{(id, d) => <Input id={id} aria-describedby={d} type="number" min={100} max={230} value={phys.hrMax} onChange={(e) => setPhys({ ...phys, hrMax: e.target.value })} />}</Field>
        <Field label="FC en reposo (ppm)">{(id) => <Input id={id} type="number" min={30} max={120} value={phys.hrRest} onChange={(e) => setPhys({ ...phys, hrRest: e.target.value })} />}</Field>
        <Field label="FTP (W)">{(id) => <Input id={id} type="number" min={50} max={600} value={phys.ftp} onChange={(e) => setPhys({ ...phys, ftp: e.target.value })} />}</Field>
      </div>
      <Button style={{ alignSelf: 'flex-end' }} loading={patch.isPending} onClick={() => patch.mutate({ weightKg: num(phys.weightKg), hrMax: num(phys.hrMax), hrRest: num(phys.hrRest), ftp: num(phys.ftp) }, { onSuccess: () => toast.show('Datos guardados', { tone: 'success' }) })}>Guardar datos</Button>
    </Section>
  );
}

interface Zone { id: string; lat: number; lng: number; radiusM: number; label: string }

function PrivacySection() {
  const { session, setMe } = useSession();
  const me = session!.user;
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ lat: number; lng: number } | null>(null);
  const [radius, setRadius] = useState(300);
  const [label, setLabel] = useState('Casa');
  const zones = useQuery({ queryKey: ['zones'], queryFn: () => api<Zone[]>('/me/privacy-zones') });
  const blocks = useQuery({ queryKey: ['blocks'], queryFn: () => api<UserCard[]>('/me/blocks') });
  const patch = useMutation({ mutationFn: (p: ProfilePatch) => api<Me>('/me', { method: 'PATCH', body: p }), onSuccess: setMe, onError: toast.error });
  const add = useMutation({
    mutationFn: () => api('/me/privacy-zones', { method: 'POST', body: { lat: draft!.lat, lng: draft!.lng, radiusM: radius, label } }),
    onSuccess: () => { setAdding(false); setDraft(null); void qc.invalidateQueries({ queryKey: ['zones'] }); toast.show('Zona privada añadida. Se aplica a todas tus actividades.', { tone: 'success' }); },
    onError: toast.error,
  });
  const del = useMutation({ mutationFn: (id: string) => api(`/me/privacy-zones/${id}`, { method: 'DELETE' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['zones'] }) });
  const unblock = useMutation({ mutationFn: (id: string) => api(`/users/${id}/block`, { method: 'DELETE' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['blocks'] }) });
  // Círculo aproximado para previsualizar la zona en el mapa.
  const circle = draft ? [{ id: 'zone', lat: Array.from({ length: 49 }, (_, i) => draft.lat + (radius / 111_195) * Math.sin((i / 48) * 2 * Math.PI)), lng: Array.from({ length: 49 }, (_, i) => draft.lng + (radius / (111_195 * Math.cos((draft.lat * Math.PI) / 180))) * Math.cos((i / 48) * 2 * Math.PI)), color: '#e5484d' }] : [];
  return (
    <Section id="privacidad" title="Privacidad" description="Controla quién ve tu actividad y qué ubicaciones se ocultan.">
      <Switch checked={me.isPrivate} onChange={(v) => patch.mutate({ isPrivate: v })} label={<span><strong>Cuenta privada</strong><span className="small muted"> · tendrás que aprobar a cada seguidor</span></span>} />
      <hr className="divider" />
      <div className="row between wrap">
        <div><h3>Zonas privadas</h3><p className="small muted">Los puntos dentro de estas zonas se ocultan a los demás en mapas, recorridos y vistas previas.</p></div>
        <Button size="sm" icon={MapPinOff} disabled={(zones.data?.length ?? 0) >= 5} onClick={() => setAdding(true)}>Añadir zona</Button>
      </div>
      <div className="list">
        {zones.data?.map((z) => (
          <div key={z.id} className="list-item">
            <span className="list-item__icon"><MapPinOff aria-hidden /></span>
            <span className="grow small">{z.label || 'Zona'} · radio {z.radiusM} m</span>
            <Button size="sm" variant="ghost" icon={Trash2} aria-label="Eliminar zona" onClick={async () => { if (await confirm({ title: 'Eliminar zona privada', message: 'Los puntos de esa zona volverán a ser visibles según la visibilidad de cada actividad.', confirmLabel: 'Eliminar', danger: true })) del.mutate(z.id); }} />
          </div>
        ))}
        {zones.data?.length === 0 && <p className="small subtle">No tienes zonas privadas.</p>}
      </div>
      {!!blocks.data?.length && (
        <>
          <hr className="divider" />
          <h3>Personas bloqueadas</h3>
          <div className="list">
            {blocks.data.map((u) => (
              <div key={u.id} className="list-item">
                <Avatar url={mediaUrl(u.avatarUrl)} name={u.displayName} size="sm" />
                <span className="grow small">{u.displayName} <span className="subtle">@{u.username}</span></span>
                <Button size="sm" variant="ghost" icon={UserX} onClick={() => unblock.mutate(u.id)}>Desbloquear</Button>
              </div>
            ))}
          </div>
        </>
      )}
      <Dialog open={adding} onClose={() => setAdding(false)} title="Nueva zona privada" wide footer={<><Button variant="ghost" onClick={() => setAdding(false)}>Cancelar</Button><Button variant="primary" disabled={!draft} loading={add.isPending} onClick={() => add.mutate()}>Guardar zona</Button></>}>
        <div className="stack">
          <p className="small muted">Toca el mapa para situar el centro (tu casa, el trabajo…).</p>
          <MapView tracks={circle} onMapClick={setDraft} waypoints={draft ? [draft] : []} className="zone-map" label="Mapa para elegir la zona" />
          <div className="form-grid form-grid--2">
            <Field label={`Radio: ${radius} m`}>{(id) => <input id={id} type="range" min={100} max={2000} step={50} value={radius} onChange={(e) => setRadius(Number(e.target.value))} />}</Field>
            <Field label="Etiqueta">{(id) => <Input id={id} value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />}</Field>
          </div>
        </div>
      </Dialog>
    </Section>
  );
}

interface SessionRow { id: string; platform: string; userAgent: string | null; lastUsedAt: string; current: boolean }

function SecuritySection() {
  const toast = useToast();
  const qc = useQueryClient();
  const [pw, setPw] = useState({ current: '', next: '' });
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<SessionRow[]>('/auth/sessions') });
  const change = useMutation({ mutationFn: () => api('/auth/password', { method: 'POST', body: pw }), onSuccess: () => { setPw({ current: '', next: '' }); toast.show('Contraseña cambiada. Se cerraron las demás sesiones.', { tone: 'success' }); void qc.invalidateQueries({ queryKey: ['sessions'] }); }, onError: toast.error });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/auth/sessions/${id}`, { method: 'DELETE' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['sessions'] }) });
  return (
    <Section id="seguridad" title="Seguridad">
      <div className="form-grid form-grid--2">
        <Field label="Contraseña actual">{(id) => <Input id={id} type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />}</Field>
        <Field label="Nueva contraseña" hint="Mínimo 10 caracteres.">{(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />}</Field>
      </div>
      <Button style={{ alignSelf: 'flex-end' }} disabled={!pw.current || pw.next.length < 10} loading={change.isPending} onClick={() => change.mutate()}>Cambiar contraseña</Button>
      <h3>Sesiones abiertas</h3>
      <div className="list">
        {sessions.data?.map((s) => (
          <div key={s.id} className="list-item">
            <span className="list-item__icon">{s.platform === 'web' ? <Monitor aria-hidden /> : <Smartphone aria-hidden />}</span>
            <span className="grow small"><strong>{s.platform === 'android' ? 'Android' : s.platform === 'windows' ? 'Windows' : 'Navegador'}</strong> · {relativeDate(s.lastUsedAt)}<div className="xs subtle ellipsis">{s.userAgent}</div></span>
            {s.current ? <Chip tone="accent">Esta sesión</Chip> : <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>Cerrar</Button>}
          </div>
        ))}
      </div>
    </Section>
  );
}

function DataSection() {
  const { logout } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');
  const pwa = usePwa();
  const del = useMutation({
    mutationFn: () => api('/me', { method: 'DELETE', body: { password } }),
    onSuccess: async () => { await logout({ force: true }); navigate('/entrar', { replace: true }); },
    onError: toast.error,
  });
  const doLogout = async () => {
    const r = await logout();
    if (r && 'pending' in r) {
      if (await confirm({ title: 'Hay cambios sin sincronizar', message: `Tienes ${r.pending} cambio(s) pendientes. Si cierras sesión ahora se perderán. Conéctate a internet para sincronizarlos antes.`, confirmLabel: 'Cerrar sesión igualmente', danger: true })) {
        await logout({ force: true });
      } else return;
    }
    navigate('/entrar', { replace: true });
  };
  return (
    <Section id="datos" title="Tus datos y la aplicación">
      {pwa.canInstall && platform === 'web' && <Button icon={Download} onClick={() => void promptInstall()}>Instalar Trazo en este dispositivo</Button>}
      <div className="row wrap">
        <Button icon={Download} onClick={() => void download('/me/export', 'trazo-datos.json').catch(toast.error)}>Descargar todos mis datos</Button>
        <Button icon={LogOut} onClick={doLogout}>Cerrar sesión</Button>
      </div>
      <p className="xs subtle">Al cerrar sesión se eliminan de este dispositivo los datos guardados de tu cuenta.</p>
      <hr className="divider" />
      <div className="row between wrap">
        <div><h3 style={{ color: 'var(--danger)' }}>Eliminar cuenta</h3><p className="small muted">Se borran de forma permanente tu perfil, actividades, recorridos, fotos y comentarios.</p></div>
        <Button variant="danger-ghost" icon={Trash2} onClick={() => setDeleting(true)}>Eliminar cuenta</Button>
      </div>
      <Dialog open={deleting} onClose={() => setDeleting(false)} title="Eliminar cuenta" footer={<><Button variant="ghost" onClick={() => setDeleting(false)}>Cancelar</Button><Button variant="danger" disabled={!password} loading={del.isPending} onClick={() => del.mutate()}>Eliminar definitivamente</Button></>}>
        <div className="stack">
          <Notice icon={Info} tone="danger">Esta acción no se puede deshacer. Te recomendamos descargar tus datos antes. Si tienes una suscripción de pago, cancélala primero.</Notice>
          <Field label="Confirma con tu contraseña">{(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        </div>
      </Dialog>
    </Section>
  );
}

export default function SettingsPage() {
  useDocumentTitle('Ajustes');
  const { session } = useSession();
  const [params] = useSearchParams();
  const welcome = params.get('bienvenida');
  const plan = session!.entitlements.plan;
  useEffect(() => {
    if (window.location.hash) document.querySelector(window.location.hash)?.scrollIntoView();
  }, []);
  return (
    <div className="page page--narrow stack" style={{ ['--gap' as string]: '20px' }}>
      <div className="page__head" style={{ marginBottom: 0 }}><h1>Ajustes</h1></div>
      {welcome && <Notice icon={Sparkles} tone="accent"><strong>¡Bienvenido a Trazo!</strong> Completa tu perfil y, si quieres, añade una zona privada para ocultar el entorno de tu casa.</Notice>}
      <Link to="/plus" className="card card--pad row between plus-hero">
        <span className="row"><Sparkles style={{ color: 'var(--accent-strong)' }} aria-hidden /> <span><strong>{plan === 'plus' ? 'Trazo Plus activo' : 'Trazo Plus'}</strong><div className="small muted">{plan === 'plus' ? 'Gestiona tu suscripción' : 'Análisis, planes y herramientas avanzadas'}</div></span></span>
        <Chip tone="plus">{plan === 'plus' ? 'Activo' : 'Ver'}</Chip>
      </Link>
      <ProfileSection />
      <PreferencesSection />
      <PrivacySection />
      <SecuritySection />
      <DataSection />
      {session!.user.role !== 'user' && <Link to="/moderacion" className="card card--pad row"><Shield aria-hidden /> Panel de moderación</Link>}
    </div>
  );
}
