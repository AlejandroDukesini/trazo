import { FEATURES, UNAVAILABLE_FEATURES, type Feature } from '@trazo/core';
import { Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Button } from '../../ui/primitives';

/** Aviso de función Plus. El acceso real lo decide siempre el servidor. */
export function PlusLock({ feature, compact, children }: { feature: Feature; compact?: boolean; children?: React.ReactNode }) {
  const navigate = useNavigate();
  const unavailable = UNAVAILABLE_FEATURES[feature];
  if (compact) {
    return (
      <div className="row between wrap">
        <span className="small muted row" style={{ ['--gap' as string]: '8px' }}><Sparkles width={16} height={16} className="subtle" /> {FEATURES[feature]} forma parte de Trazo Plus.</span>
        <Button size="sm" variant="secondary" onClick={() => navigate('/plus')}>Ver Plus</Button>
      </div>
    );
  }
  return (
    <div className="card premium-lock">
      <div className="empty__icon" style={{ background: 'var(--accent-soft)', color: 'var(--accent-strong)' }}><Sparkles aria-hidden /></div>
      <h3>{FEATURES[feature]}</h3>
      <p className="muted small" style={{ maxWidth: '46ch' }}>{children ?? 'Esta función forma parte de Trazo Plus.'}</p>
      {unavailable ? <p className="xs subtle">{unavailable}</p> : <Button variant="primary" onClick={() => navigate('/plus')}>Conocer Trazo Plus</Button>}
    </div>
  );
}
