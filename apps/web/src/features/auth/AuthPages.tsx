import { UsernameSchema } from '@trazo/core';
import { CheckCircle2, MailCheck } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { Brand } from '../../app/Brand';
import { useDocumentTitle } from '../../app/hooks';
import { ApiError, api } from '../../data/api';
import { useSession } from '../../data/session';
import { Button, Field, Input, Notice } from '../../ui/primitives';

function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  useDocumentTitle(title);
  return (
    <main className="auth">
      <div className="auth__card">
        <Brand />
        <div className="card card--pad stack">
          <div className="stack" style={{ ['--gap' as string]: '4px' }}>
            <h1>{title}</h1>
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          {children}
        </div>
        {footer && <p className="auth__alt">{footer}</p>}
      </div>
    </main>
  );
}

function fieldErrors(err: unknown): Record<string, string> {
  if (err instanceof ApiError && Array.isArray(err.details)) {
    return Object.fromEntries((err.details as Array<{ path: string; message: string }>).map((d) => [d.path, d.message]));
  }
  return {};
}

export function LoginPage() {
  const { login } = useSession();
  const navigate = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate((loc.state as { from?: string } | null)?.from ?? '/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError && err.isNetwork ? 'No hay conexión con el servidor. Inténtalo cuando vuelvas a tener red.' : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Entrar" subtitle="Tu entrenamiento, en todos tus dispositivos." footer={<>¿No tienes cuenta? <Link className="link" to="/registro">Crear cuenta</Link></>}>
      <form className="stack" onSubmit={submit} noValidate>
        {error && <Notice icon={MailCheck} tone="danger">{error}</Notice>}
        <Field label="Correo electrónico">{(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Contraseña">{(id) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        <Button type="submit" variant="primary" size="lg" block loading={busy}>Entrar</Button>
        <Link className="link small" to="/recuperar" style={{ textAlign: 'center' }}>He olvidado mi contraseña</Link>
      </form>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { register } = useSession();
  const navigate = useNavigate();
  const [form, setForm] = useState({ displayName: '', username: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    const u = UsernameSchema.safeParse(form.username);
    if (!u.success) local.username = u.error.issues[0]!.message;
    if (form.password.length < 10) local.password = 'Mínimo 10 caracteres';
    if (!form.displayName.trim()) local.displayName = 'Indica tu nombre';
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    setError(null);
    try {
      await register(form);
      navigate('/ajustes?bienvenida=1', { replace: true });
    } catch (err) {
      setErrors(fieldErrors(err));
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Crear cuenta" subtitle="Registra tus actividades y entrena con tu gente." footer={<>¿Ya tienes cuenta? <Link className="link" to="/entrar">Entrar</Link></>}>
      <form className="stack" onSubmit={submit} noValidate>
        {error && <Notice icon={MailCheck} tone="danger">{error}</Notice>}
        <Field label="Nombre" error={errors.displayName}>{(id, d) => <Input id={id} aria-describedby={d} autoComplete="name" value={form.displayName} onChange={set('displayName')} />}</Field>
        <Field label="Nombre de usuario" hint="Letras, números, punto y guion bajo." error={errors.username}>{(id, d) => <Input id={id} aria-describedby={d} autoCapitalize="none" autoComplete="username" value={form.username} onChange={set('username')} />}</Field>
        <Field label="Correo electrónico" error={errors.email}>{(id, d) => <Input id={id} aria-describedby={d} type="email" autoComplete="email" value={form.email} onChange={set('email')} />}</Field>
        <Field label="Contraseña" hint="Mínimo 10 caracteres." error={errors.password}>{(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />}</Field>
        <Button type="submit" variant="primary" size="lg" block loading={busy}>Crear cuenta</Button>
        <p className="xs subtle" style={{ textAlign: 'center' }}>Tus actividades son visibles para tus seguidores por defecto. Puedes cambiarlo en Ajustes.</p>
      </form>
    </AuthLayout>
  );
}

export function ForgotPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password-reset/request', { method: 'POST', body: { email } });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout title="Recuperar contraseña" footer={<Link className="link" to="/entrar">Volver a entrar</Link>}>
      {sent ? (
        <Notice icon={MailCheck} tone="accent">Si existe una cuenta con ese correo, recibirás un enlace para elegir una contraseña nueva. Caduca en 1 hora.</Notice>
      ) : (
        <form className="stack" onSubmit={submit}>
          {error && <Notice icon={MailCheck} tone="danger">{error}</Notice>}
          <Field label="Correo electrónico">{(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Button type="submit" variant="primary" block loading={busy}>Enviar enlace</Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password-reset/confirm', { method: 'POST', body: { token, password } });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout title="Nueva contraseña" footer={<Link className="link" to="/entrar">Ir a entrar</Link>}>
      {done ? (
        <Notice icon={CheckCircle2} tone="accent">Contraseña actualizada. Se han cerrado las sesiones abiertas en otros dispositivos.</Notice>
      ) : (
        <form className="stack" onSubmit={submit}>
          {!token && <Notice icon={MailCheck} tone="danger">El enlace no es válido.</Notice>}
          {error && <Notice icon={MailCheck} tone="danger">{error}</Notice>}
          <Field label="Contraseña nueva" hint="Mínimo 10 caracteres.">{(id) => <Input id={id} type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
          <Button type="submit" variant="primary" block loading={busy} disabled={!token}>Guardar contraseña</Button>
        </form>
      )}
    </AuthLayout>
  );
}
