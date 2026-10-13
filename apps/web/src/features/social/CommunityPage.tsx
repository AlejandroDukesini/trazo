import { ClubSchema, SPORTS, SPORT_KEYS } from '@trazo/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Shield, Trophy, Users } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useDocumentTitle } from '../../app/hooks';
import { api, mediaUrl } from '../../data/api';
import type { UserCard } from '../../data/types';
import { Dialog } from '../../ui/dialog';
import { Avatar, Button, Chip, Empty, Field, Input, Select, Skeleton, Textarea } from '../../ui/primitives';
import { useToast } from '../../ui/toast';

export interface ClubSummary { id: string; name: string; description: string; sport: string | null; visibility: 'public' | 'private'; myStatus: string | null; myRole: string | null; members: number }

function CreateClub({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', description: '', sport: '', visibility: 'public' as 'public' | 'private' });
  const m = useMutation({
    mutationFn: () => api<{ id: string }>('/clubs', { method: 'POST', body: ClubSchema.parse({ ...f, sport: f.sport || null }) }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['clubs'] }); onClose(); navigate(`/clubes/${r.id}`); },
    onError: toast.error,
  });
  return (
    <Dialog open={open} onClose={onClose} title="Crear club" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} disabled={f.name.trim().length < 3} onClick={() => m.mutate()}>Crear</Button></>}>
      <div className="form-grid">
        <Field label="Nombre">{(id) => <Input id={id} value={f.name} maxLength={60} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Descripción">{(id) => <Textarea id={id} value={f.description} maxLength={1000} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        <div className="form-grid form-grid--2">
          <Field label="Deporte">{(id) => <Select id={id} value={f.sport} onChange={(e) => setF({ ...f, sport: e.target.value })}><option value="">Varios</option>{SPORT_KEYS.map((k) => <option key={k} value={k}>{SPORTS[k]!.label}</option>)}</Select>}</Field>
          <Field label="Tipo" hint={f.visibility === 'private' ? 'Solo por invitación o solicitud aprobada.' : 'Cualquiera puede unirse.'}>{(id, d) => <Select id={id} aria-describedby={d} value={f.visibility} onChange={(e) => setF({ ...f, visibility: e.target.value as 'public' | 'private' })}><option value="public">Público</option><option value="private">Privado</option></Select>}</Field>
        </div>
      </div>
    </Dialog>
  );
}

export default function CommunityPage() {
  useDocumentTitle('Comunidad');
  const [q, setQ] = useState('');
  const deferred = useDeferredValue(q.trim());
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const people = useQuery({ queryKey: ['users', deferred], enabled: deferred.length >= 2, queryFn: () => api<UserCard[]>(`/users?q=${encodeURIComponent(deferred)}`) });
  const myClubs = useQuery({ queryKey: ['clubs', 'mine'], queryFn: () => api<ClubSummary[]>('/clubs?mine=true') });
  const clubs = useQuery({ queryKey: ['clubs', 'search', deferred], queryFn: () => api<ClubSummary[]>(`/clubs${deferred ? `?q=${encodeURIComponent(deferred)}` : ''}`) });

  return (
    <div className="page page--wide">
      <div className="page__head">
        <div><h1>Comunidad</h1><p>Encuentra personas y clubes con los que entrenar.</p></div>
        <div className="row"><Button icon={Trophy} onClick={() => navigate('/retos')}>Retos</Button><Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Crear club</Button></div>
      </div>
      <div className="row" style={{ marginBottom: 20 }}>
        <Search className="subtle" aria-hidden />
        <Input aria-label="Buscar personas o clubes" placeholder="Busca personas o clubes por nombre" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="grid-2 grid-2--even">
        <section className="card">
          <div className="card__head"><h2 className="section-title">Personas</h2></div>
          <div className="list">
            {deferred.length < 2 && <div className="card__body"><p className="small subtle">Escribe al menos 2 letras para buscar.</p></div>}
            {people.isFetching && <div className="card__body"><Skeleton h={48} /></div>}
            {people.data?.length === 0 && <div className="card__body"><p className="small subtle">Sin resultados.</p></div>}
            {people.data?.map((u) => (
              <Link key={u.id} to={`/atleta/${u.username}`} className="list-item">
                <Avatar url={mediaUrl(u.avatarUrl)} name={u.displayName} size="sm" />
                <span className="grow"><strong className="small">{u.displayName}</strong><div className="xs subtle">@{u.username}</div></span>
              </Link>
            ))}
          </div>
        </section>
        <section className="stack">
          {!!myClubs.data?.length && (
            <div className="card">
              <div className="card__head"><h2 className="section-title">Tus clubes</h2></div>
              <ClubList clubs={myClubs.data} />
            </div>
          )}
          <div className="card">
            <div className="card__head"><h2 className="section-title">{deferred ? 'Clubes encontrados' : 'Clubes destacados'}</h2></div>
            {clubs.isPending ? <div className="card__body"><Skeleton h={48} /></div> : clubs.data?.length ? <ClubList clubs={clubs.data} /> : <Empty icon={Users} title="No hay clubes todavía">Crea el primero e invita a tu grupo.</Empty>}
          </div>
        </section>
      </div>
      <CreateClub open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function ClubList({ clubs }: { clubs: ClubSummary[] }) {
  return (
    <div className="list">
      {clubs.map((c) => (
        <Link key={c.id} to={`/clubes/${c.id}`} className="list-item">
          <span className="list-item__icon">{c.visibility === 'private' ? <Shield aria-label="Privado" /> : <Users aria-hidden />}</span>
          <span className="grow"><strong className="small">{c.name}</strong><div className="xs subtle">{c.members} miembro{c.members === 1 ? '' : 's'}{c.sport ? ` · ${SPORTS[c.sport]?.label}` : ''}</div></span>
          {c.myStatus === 'active' && <Chip tone="accent">Miembro</Chip>}
          {c.myStatus === 'invited' && <Chip tone="warning">Invitación</Chip>}
          {c.myStatus === 'requested' && <Chip>Solicitado</Chip>}
        </Link>
      ))}
    </div>
  );
}
