import { useState } from 'react';
import {
  Camera, Download, ImageUp, Monitor, Moon, Sun, Trash2, Info,
} from 'lucide-react';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useDocumentTitle } from '../../app/hooks';
import { promptInstall, usePwa } from '../../app/pwa';
import { useTheme, type ThemePref } from '../../app/theme';
import { deleteUserDb, metaDel, userDb } from '../../data/db';
import { useSession } from '../../data/session';
import { platform } from '../../platform';
import { saveFile } from '../../platform/files';
import { Dialog, useConfirm } from '../../ui/dialog';
import { Avatar, Button, Field, Input, Notice, Segmented, Select } from '../../ui/primitives';
import { useToast } from '../../ui/toast';

function Section({ id, title, children, description }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="card card--pad stack" id={id} aria-labelledby={`${id}-t`}>
      <div><h2 id={`${id}-t`}>{title}</h2>{description && <p className="small muted">{description}</p>}</div>
      {children}
    </section>
  );
}

/** Redimensiona una imagen a un avatar pequeño (data URL) para no inflar el perfil. */
function fileToAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 256;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d')!.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen.')); };
    img.src = url;
  });
}

function ProfileSection() {
  const { me, setMe } = useSession();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(me!.displayName);
  const [avatarInput, setAvatarInput] = useState<HTMLInputElement | null>(null);
  const onAvatar = async (file: File) => {
    try {
      const url = await fileToAvatar(file);
      setMe({ ...me!, avatarUrl: url });
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <Section id="perfil" title="Perfil" description="Solo se guarda en este dispositivo. No hay cuenta ni servidor.">
      <div className="row">
        <Avatar url={me!.avatarUrl} name={me!.displayName} size="lg" />
        <div className="row wrap">
          <Button size="sm" icon={Camera} onClick={() => avatarInput?.click()}>Cambiar foto</Button>
          {me!.avatarUrl && <Button size="sm" variant="ghost" onClick={() => setMe({ ...me!, avatarUrl: null })}>Quitar</Button>}
          <input ref={setAvatarInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f0 = e.target.files?.[0]; if (f0) void onAvatar(f0); e.target.value = ''; }} />
        </div>
      </div>
      <Field label="Nombre">{(id) => <Input id={id} value={displayName} maxLength={60} onChange={(e) => setDisplayName(e.target.value)} />}</Field>
      <Button variant="primary" style={{ alignSelf: 'flex-end' }} onClick={() => { setMe({ ...me!, displayName: displayName.trim() || 'Yo' }); toast.show('Perfil actualizado', { tone: 'success' }); }}>Guardar perfil</Button>
    </Section>
  );
}

function PreferencesSection() {
  const { me, setMe } = useSession();
  const toast = useToast();
  const { preference, setPreference } = useTheme();
  const [phys, setPhys] = useState({ weightKg: me!.weightKg?.toString() ?? '', hrMax: me!.hrMax?.toString() ?? '', hrRest: me!.hrRest?.toString() ?? '', ftp: me!.ftp?.toString() ?? '' });
  const num = (v: string) => (v.trim() ? Number(v) : null);
  return (
    <Section id="preferencias" title="Preferencias">
      <div className="field">
        <span className="field__label">Tema</span>
        <Segmented<ThemePref> label="Tema" value={preference} onChange={setPreference} options={[{ value: 'system', label: 'Sistema', icon: Monitor }, { value: 'light', label: 'Claro', icon: Sun }, { value: 'dark', label: 'Oscuro', icon: Moon }]} />
      </div>
      <Field label="Unidades">{(id) => <Select id={id} value={me!.units} onChange={(e) => setMe({ ...me!, units: e.target.value as 'metric' | 'imperial' })}><option value="metric">Métricas (km, m)</option><option value="imperial">Imperiales (mi, ft)</option></Select>}</Field>
      <hr className="divider" />
      <div>
        <h3>Datos fisiológicos</h3>
        <p className="small muted">Opcionales. Se usan para estimar calorías (peso) y calcular zonas y carga (FC máxima). Solo en este dispositivo.</p>
      </div>
      <div className="form-grid form-grid--2">
        <Field label="Peso (kg)">{(id) => <Input id={id} type="number" min={25} max={300} value={phys.weightKg} onChange={(e) => setPhys({ ...phys, weightKg: e.target.value })} />}</Field>
        <Field label="FC máxima (ppm)" hint="Mejor si procede de una prueba real.">{(id, d) => <Input id={id} aria-describedby={d} type="number" min={100} max={230} value={phys.hrMax} onChange={(e) => setPhys({ ...phys, hrMax: e.target.value })} />}</Field>
        <Field label="FC en reposo (ppm)">{(id) => <Input id={id} type="number" min={30} max={120} value={phys.hrRest} onChange={(e) => setPhys({ ...phys, hrRest: e.target.value })} />}</Field>
        <Field label="FTP (W)">{(id) => <Input id={id} type="number" min={50} max={600} value={phys.ftp} onChange={(e) => setPhys({ ...phys, ftp: e.target.value })} />}</Field>
      </div>
      <Button style={{ alignSelf: 'flex-end' }} onClick={() => { setMe({ ...me!, weightKg: num(phys.weightKg), hrMax: num(phys.hrMax), hrRest: num(phys.hrRest), ftp: num(phys.ftp) }); toast.show('Datos guardados', { tone: 'success' }); }}>Guardar datos</Button>
    </Section>
  );
}

function ImportSection() {
  const navigate = useNavigate();
  return (
    <Section id="importar" title="Importar actividades" description="Añade actividades desde Strava u otra app sin conexión entre servicios.">
      <div className="row wrap">
        <Button icon={ImageUp} variant="primary" onClick={() => navigate('/actividades/importar?modo=pantallazo')}>Desde un pantallazo</Button>
        <Button icon={Download} onClick={() => navigate('/actividades/importar')}>Desde archivo GPX/TCX</Button>
      </div>
      <p className="xs subtle">El pantallazo se lee en el propio dispositivo (OCR) para rellenar los datos; siempre puedes revisarlos y corregirlos antes de guardar.</p>
    </Section>
  );
}

function DataSection() {
  const toast = useToast();
  const confirm = useConfirm();
  const pwa = usePwa();
  const exportAll = async () => {
    try {
      const db = userDb();
      const [activities, streams, routes, segments, goals] = await Promise.all([
        db.activities.toArray(), db.streams.toArray(), db.routes.toArray(), db.segments.toArray(), db.goals.toArray(),
      ]);
      const payload = { app: 'Trazo', version: 1, exportedAt: new Date().toISOString(), activities, streams, routes, segments, goals };
      await saveFile('trazo-datos.json', new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    } catch (err) {
      toast.error(err);
    }
  };
  const wipe = async () => {
    if (!(await confirm({ title: 'Borrar todos mis datos', message: 'Se eliminarán de este dispositivo todas tus actividades, rutas, segmentos, objetivos y tu perfil. Esta acción no se puede deshacer. Descarga una copia antes si quieres conservarla.', confirmLabel: 'Borrar todo', danger: true }))) return;
    await deleteUserDb();
    await metaDel('profile');
    window.location.href = '/';
  };
  return (
    <Section id="datos" title="Tus datos y la aplicación">
      {pwa.canInstall && platform === 'web' && <Button icon={Download} onClick={() => void promptInstall()}>Instalar Trazo en este dispositivo</Button>}
      <div className="row wrap">
        <Button icon={Download} onClick={() => void exportAll()}>Descargar todos mis datos</Button>
      </div>
      <p className="xs subtle">Se descarga un archivo JSON con tus actividades, rutas, segmentos y objetivos.</p>
      <hr className="divider" />
      <div className="row between wrap">
        <div><h3 style={{ color: 'var(--danger)' }}>Borrar todos mis datos</h3><p className="small muted">Elimina de forma permanente todo lo guardado en este dispositivo.</p></div>
        <Button variant="danger-ghost" icon={Trash2} onClick={() => void wipe()}>Borrar todo</Button>
      </div>
      <Notice icon={Info}>Trazo es totalmente local: tus datos no salen de este dispositivo y no hay cuenta ni inicio de sesión.</Notice>
    </Section>
  );
}

export default function SettingsPage() {
  useDocumentTitle('Ajustes');
  useEffect(() => {
    if (window.location.hash) document.querySelector(window.location.hash)?.scrollIntoView();
  }, []);
  return (
    <div className="page page--narrow stack" style={{ ['--gap' as string]: '20px' }}>
      <div className="page__head" style={{ marginBottom: 0 }}><h1>Ajustes</h1></div>
      <ProfileSection />
      <PreferencesSection />
      <ImportSection />
      <DataSection />
    </div>
  );
}
