import {
  forwardRef, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import type { LucideIcon } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  block?: boolean;
  loading?: boolean;
  icon?: LucideIcon;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', block, loading, icon: Icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  const cls = ['btn', `btn--${variant}`, size !== 'md' && `btn--${size}`, block && 'btn--block', className].filter(Boolean).join(' ');
  return (
    <button ref={ref} type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="spinner" aria-hidden /> : Icon ? <Icon aria-hidden /> : null}
      {children}
    </button>
  );
});

export function IconButton({ icon: Icon, label, active, badge, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; active?: boolean; badge?: number }) {
  return (
    <button type="button" className={['icon-btn', active && 'icon-btn--active', className].filter(Boolean).join(' ')} aria-label={label} title={label} {...rest}>
      <Icon aria-hidden />
      {badge ? <span className="dot">{badge > 99 ? '99+' : badge}</span> : null}
    </button>
  );
}

/** Botón que exige mantener pulsado: evita finalizar o descartar por accidente durante el ejercicio. */
export function HoldButton({ onConfirm, holdMs = 900, children, className, ...rest }: Omit<ButtonProps, 'onClick'> & { onConfirm: () => void; holdMs?: number }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);
  const start = () => {
    setHolding(true);
    timer.current = window.setTimeout(() => {
      setHolding(false);
      navigator.vibrate?.(30);
      onConfirm();
    }, holdMs);
  };
  const cancel = () => {
    setHolding(false);
    if (timer.current) window.clearTimeout(timer.current);
  };
  useEffect(() => cancel, []);
  return (
    <Button
      {...rest}
      className={['hold', holding && 'is-holding', className].filter(Boolean).join(' ')}
      style={{ ['--hold-ms' as string]: `${holdMs}ms` }}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) start(); }}
      onKeyUp={cancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="hold__fill" aria-hidden />
      <span>{children}</span>
    </Button>
  );
}

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}

export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{label}</label>
      {children(id, [hintId, errId].filter(Boolean).join(' ') || undefined)}
      {hint && !error && <span className="field__hint" id={hintId}>{hint}</span>}
      {error && <span className="field__error" id={errId} role="alert">{error}</span>}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={['input', className].filter(Boolean).join(' ')} {...p} />;
});
export function Select({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={['select', className].filter(Boolean).join(' ')} {...p} />;
}
export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={['textarea', className].filter(Boolean).join(' ')} {...p} />;
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string; icon?: LucideIcon }>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.icon && <o.icon aria-hidden />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, unit, note, size }: { label: string; value: ReactNode; unit?: string; note?: ReactNode; size?: 'lg' }) {
  return (
    <div className={['stat', size && `stat--${size}`].filter(Boolean).join(' ')}>
      <span className="stat__label">{label}</span>
      <span className="stat__value">
        {value}
        {unit && <small>{unit}</small>}
      </span>
      {note && <span className="stat__note">{note}</span>}
    </div>
  );
}

export function Avatar({ url, name, size }: { url: string | null | undefined; name: string; size?: 'sm' | 'lg' | 'xl' }) {
  const cls = ['avatar', size && `avatar--${size}`].filter(Boolean).join(' ');
  const [broken, setBroken] = useState(false);
  if (url && !broken) return <img className={cls} src={url} alt="" loading="lazy" onError={() => setBroken(true)} />;
  const initials = name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  return <span className={cls} aria-hidden>{initials || '·'}</span>;
}

export function Skeleton({ w = '100%', h = 16, r, style }: { w?: number | string; h?: number | string; r?: number; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ width: w, height: h, borderRadius: r, ...style }} aria-hidden />;
}

export function Spinner({ label = 'Cargando' }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function Empty({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__icon"><Icon aria-hidden /></div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Notice({ icon: Icon, tone, children }: { icon: LucideIcon; tone?: 'warning' | 'danger' | 'accent'; children: ReactNode }) {
  return (
    <div className={['notice', tone && `notice--${tone}`].filter(Boolean).join(' ')} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function Progress({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Chip({ children, tone, icon: Icon }: { children: ReactNode; tone?: 'accent' | 'warning' | 'danger' | 'plus'; icon?: LucideIcon }) {
  return (
    <span className={['chip', tone && `chip--${tone}`].filter(Boolean).join(' ')}>
      {Icon && <Icon aria-hidden />}
      {children}
    </span>
  );
}
