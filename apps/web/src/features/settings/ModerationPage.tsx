import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import { useDocumentTitle } from '../../app/hooks';
import { relativeDate } from '../../components/format';
import { api } from '../../data/api';
import { useSession } from '../../data/session';
import { useConfirm } from '../../ui/dialog';
import { Button, Chip, Empty, Segmented, Skeleton } from '../../ui/primitives';
import { useToast } from '../../ui/toast';

interface Report { id: string; targetType: string; targetId: string; reason: string; details: string; status: string; createdAt: string; reporter: string }

function targetLink(r: Report) {
  if (r.targetType === 'activity') return `/actividad/${r.targetId}`;
  if (r.targetType === 'club') return `/clubes/${r.targetId}`;
  return null;
}

export default function ModerationPage() {
  useDocumentTitle('Moderación');
  const { session } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState<'open' | 'resolved' | 'dismissed'>('open');
  const q = useQuery({ queryKey: ['reports', status], queryFn: () => api<Report[]>(`/moderation/reports?status=${status}`), enabled: session?.user.role !== 'user' });
  const resolve = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => api(`/moderation/reports/${id}/resolve`, { method: 'POST', body: { action } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['reports'] }),
    onError: toast.error,
  });
  if (session?.user.role === 'user') return <Navigate to="/" replace />;
  const act = async (r: Report, action: string, label: string) => {
    if (action === 'dismiss' || (await confirm({ title: label, message: 'Esta acción es visible para la persona afectada y queda registrada.', confirmLabel: label, danger: true }))) resolve.mutate({ id: r.id, action });
  };
  return (
    <div className="page page--narrow">
      <div className="page__head"><h1>Moderación</h1></div>
      <Segmented label="Estado" value={status} onChange={setStatus} options={[{ value: 'open', label: 'Abiertas' }, { value: 'resolved', label: 'Resueltas' }, { value: 'dismissed', label: 'Descartadas' }]} />
      <div className="card" style={{ marginTop: 16 }}>
        {q.isPending && <div className="card__body"><Skeleton h={60} /></div>}
        {q.data?.length === 0 && <Empty icon={ShieldCheck} title="Sin denuncias" />}
        <div className="list">
          {q.data?.map((r) => {
            const link = targetLink(r);
            return (
              <div key={r.id} className="list-item" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div className="grow stack" style={{ ['--gap' as string]: '4px' }}>
                  <div className="row wrap"><Chip>{r.targetType}</Chip><Chip tone="warning">{r.reason}</Chip><span className="xs subtle">por @{r.reporter} · {relativeDate(r.createdAt)}</span></div>
                  {r.details && <p className="small">{r.details}</p>}
                  {link ? <Link className="link xs" to={link}>Ver contenido</Link> : <span className="xs subtle">ID: {r.targetId}</span>}
                </div>
                {status === 'open' && (
                  <div className="row wrap">
                    <Button size="sm" variant="ghost" onClick={() => void act(r, 'dismiss', 'Descartar')}>Descartar</Button>
                    {r.targetType !== 'user' && <Button size="sm" variant="danger-ghost" onClick={() => void act(r, 'remove_content', 'Eliminar contenido')}>Eliminar contenido</Button>}
                    {r.targetType !== 'club' && <Button size="sm" variant="danger" onClick={() => void act(r, 'suspend_user', 'Suspender cuenta')}>Suspender</Button>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
