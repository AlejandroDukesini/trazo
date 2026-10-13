import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../data/api';
import { Dialog } from '../../ui/dialog';
import { Button, Field, Select, Textarea } from '../../ui/primitives';
import { useToast } from '../../ui/toast';

const REASONS = { spam: 'Spam', abuse: 'Acoso o abuso', inappropriate: 'Contenido inapropiado', fraud: 'Actividad fraudulenta', privacy: 'Expone datos privados', other: 'Otro motivo' };

export function ReportDialog({ targetType, targetId, open, onClose }: { targetType: 'user' | 'activity' | 'comment' | 'club'; targetId: string; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState<keyof typeof REASONS>('spam');
  const [details, setDetails] = useState('');
  const m = useMutation({
    mutationFn: () => api('/reports', { method: 'POST', body: { targetType, targetId, reason, details } }),
    onSuccess: () => { toast.show('Denuncia enviada. La revisará el equipo de moderación.', { tone: 'success' }); onClose(); },
    onError: toast.error,
  });
  return (
    <Dialog open={open} onClose={onClose} title="Denunciar" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="danger" loading={m.isPending} onClick={() => m.mutate()}>Enviar denuncia</Button></>}>
      <div className="form-grid">
        <Field label="Motivo">{(id) => <Select id={id} value={reason} onChange={(e) => setReason(e.target.value as keyof typeof REASONS)}>{Object.entries(REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <Field label="Detalles (opcional)">{(id) => <Textarea id={id} value={details} maxLength={1000} onChange={(e) => setDetails(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}
