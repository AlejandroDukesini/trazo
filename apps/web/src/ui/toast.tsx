import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

type Tone = 'info' | 'success' | 'danger';
interface ToastItem {
  id: number;
  message: ReactNode;
  tone: Tone;
  action?: { label: string; onClick: () => void };
}

interface ToastApi {
  show: (message: ReactNode, opts?: { tone?: Tone; action?: ToastItem['action']; durationMs?: number }) => void;
  error: (err: unknown) => void;
}

const Ctx = createContext<ToastApi>({ show: () => {}, error: () => {} });

export function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: string }).message);
  return 'Algo ha ido mal. Inténtalo de nuevo.';
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const show = useCallback<ToastApi['show']>((message, opts = {}) => {
    const id = ++seq.current;
    setItems((l) => [...l.slice(-2), { id, message, tone: opts.tone ?? 'info', action: opts.action }]);
    window.setTimeout(() => dismiss(id), opts.durationMs ?? (opts.action ? 8000 : 4000));
  }, [dismiss]);
  const api = useMemo<ToastApi>(() => ({ show, error: (err) => show(errorMessage(err), { tone: 'danger' }) }), [show]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => {
          const Icon = t.tone === 'danger' ? AlertCircle : t.tone === 'success' ? CheckCircle2 : Info;
          return (
            <div key={t.id} className={['toast', t.tone === 'danger' && 'toast--danger'].filter(Boolean).join(' ')} role={t.tone === 'danger' ? 'alert' : 'status'}>
              <Icon aria-hidden />
              <span>{t.message}</span>
              {t.action && (
                <button type="button" onClick={() => { t.action!.onClick(); dismiss(t.id); }}>{t.action.label}</button>
              )}
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
