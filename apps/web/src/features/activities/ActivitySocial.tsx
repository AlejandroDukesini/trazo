import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Flame, MessageCircle, Send, Trash2, CloudOff } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { relativeDate } from '../../components/format';
import { api, mediaUrl } from '../../data/api';
import type { ActivityDTO, UserCard } from '../../data/types';
import { useConfirm } from '../../ui/dialog';
import { Avatar, Button, IconButton, Notice, Textarea } from '../../ui/primitives';
import { useToast } from '../../ui/toast';

interface Comment { id: string; body: string; createdAt: string; author: UserCard; canDelete: boolean }

export function Reactions({ a, synced }: { a: ActivityDTO; synced: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => api(`/activities/${a.id}/reaction`, { method: a.viewerReacted ? 'DELETE' : 'PUT' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['activity', a.id] });
      void qc.invalidateQueries({ queryKey: ['feed'] });
    },
    onError: toast.error,
  });
  if (!synced) return null;
  return (
    <div className="row">
      <button type="button" className={['react-btn', a.viewerReacted && 'is-on'].filter(Boolean).join(' ')} aria-pressed={a.viewerReacted} onClick={() => m.mutate()} disabled={m.isPending}>
        <Flame aria-hidden /> {a.reactionCount ? `${a.reactionCount} ánimo${a.reactionCount > 1 ? 's' : ''}` : 'Dar ánimo'}
      </button>
      <a href="#comentarios" className="react-btn"><MessageCircle aria-hidden /> {a.commentCount || ''} Comentar</a>
    </div>
  );
}

export function Comments({ a, synced }: { a: ActivityDTO; synced: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [body, setBody] = useState('');
  const q = useQuery({ queryKey: ['comments', a.id], queryFn: () => api<Comment[]>(`/activities/${a.id}/comments`), enabled: synced });
  const add = useMutation({
    mutationFn: () => api(`/activities/${a.id}/comments`, { method: 'POST', body: { body } }),
    onSuccess: () => {
      setBody('');
      void qc.invalidateQueries({ queryKey: ['comments', a.id] });
      void qc.invalidateQueries({ queryKey: ['activity', a.id] });
    },
    onError: toast.error,
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/comments/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['comments', a.id] }),
    onError: toast.error,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (body.trim()) add.mutate();
  };
  return (
    <section className="card" id="comentarios" aria-labelledby="comments-title">
      <div className="card__head"><h2 id="comments-title" className="section-title">Comentarios</h2></div>
      <div className="card__body stack">
        {!synced ? (
          <Notice icon={CloudOff}>Los comentarios estarán disponibles cuando la actividad se sincronice.</Notice>
        ) : (
          <>
            {q.data?.length === 0 && <p className="small subtle">Aún no hay comentarios.</p>}
            <div>
              {q.data?.map((c) => (
                <div key={c.id} className="comment">
                  <Link to={`/atleta/${c.author.username}`}><Avatar url={mediaUrl(c.author.avatarUrl)} name={c.author.displayName} size="sm" /></Link>
                  <div className="grow">
                    <div className="row" style={{ ['--gap' as string]: '8px' }}>
                      <Link to={`/atleta/${c.author.username}`} className="small" style={{ fontWeight: 650 }}>{c.author.displayName}</Link>
                      <span className="xs subtle">{relativeDate(c.createdAt)}</span>
                    </div>
                    <p className="small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{c.body}</p>
                  </div>
                  {c.canDelete && (
                    <IconButton icon={Trash2} label="Eliminar comentario" onClick={async () => {
                      if (await confirm({ title: 'Eliminar comentario', message: 'El comentario se eliminará para todos.', confirmLabel: 'Eliminar', danger: true })) del.mutate(c.id);
                    }} />
                  )}
                </div>
              ))}
            </div>
            <form className="row" onSubmit={submit} style={{ alignItems: 'flex-end' }}>
              <Textarea aria-label="Escribe un comentario" placeholder="Escribe un comentario…" value={body} maxLength={1000} onChange={(e) => setBody(e.target.value)} style={{ minHeight: 44 }} rows={1} />
              <Button type="submit" variant="primary" icon={Send} loading={add.isPending} disabled={!body.trim()} aria-label="Publicar comentario" />
            </form>
          </>
        )}
      </div>
    </section>
  );
}

export function Photos({ a, isOwner, synced }: { a: ActivityDTO; isOwner: boolean; synced: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api(`/activities/${a.id}/photos`, { method: 'POST', body: fd });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['activity', a.id] }),
    onError: toast.error,
  });
  const remove = useMutation({
    mutationFn: (pid: string) => api(`/activities/${a.id}/photos/${pid}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['activity', a.id] }),
    onError: toast.error,
  });
  if (!a.photos.length && !(isOwner && synced)) return null;
  return (
    <section className="card" aria-labelledby="photos-title">
      <div className="card__head">
        <h2 id="photos-title" className="section-title">Fotos</h2>
        {isOwner && synced && a.photos.length < 10 && (
          <>
            <Button size="sm" icon={Camera} loading={upload.isPending} onClick={() => input.current?.click()}>Añadir</Button>
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
          </>
        )}
      </div>
      <div className="card__body">
        {a.photos.length ? (
          <div className="photos-grid">
            {a.photos.map((p) => (
              <figure key={p.id}>
                <a href={mediaUrl(p.url)!} target="_blank" rel="noreferrer"><img src={mediaUrl(p.url)!} alt="Foto de la actividad" loading="lazy" /></a>
                {isOwner && <IconButton icon={Trash2} label="Eliminar foto" onClick={async () => { if (await confirm({ title: 'Eliminar foto', message: 'La foto se eliminará definitivamente.', confirmLabel: 'Eliminar', danger: true })) remove.mutate(p.id); }} />}
              </figure>
            ))}
          </div>
        ) : (
          <p className="small subtle">Añade fotos de tu actividad (JPEG, PNG o WebP, máx. 8 MB).</p>
        )}
      </div>
    </section>
  );
}
