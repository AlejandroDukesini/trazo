import type { Kysely } from 'kysely';
import type { DB } from '../db/types.js';

export interface Relation {
  self: boolean;
  /** El espectador sigue (aceptado) al propietario. */
  follower: boolean;
  pending: boolean;
  /** Bloqueo en cualquier sentido. */
  blocked: boolean;
  blockedByViewer: boolean;
}

export async function relation(db: Kysely<DB>, viewerId: string | null, ownerId: string): Promise<Relation> {
  if (viewerId === ownerId) return { self: true, follower: true, pending: false, blocked: false, blockedByViewer: false };
  if (!viewerId) return { self: false, follower: false, pending: false, blocked: false, blockedByViewer: false };
  const [follow, blocks] = await Promise.all([
    db.selectFrom('follows').select('status').where('follower_id', '=', viewerId).where('followee_id', '=', ownerId).executeTakeFirst(),
    db
      .selectFrom('blocks')
      .select(['blocker_id'])
      .where((eb) =>
        eb.or([
          eb.and([eb('blocker_id', '=', viewerId), eb('blocked_id', '=', ownerId)]),
          eb.and([eb('blocker_id', '=', ownerId), eb('blocked_id', '=', viewerId)]),
        ]),
      )
      .execute(),
  ]);
  return {
    self: false,
    follower: follow?.status === 'accepted',
    pending: follow?.status === 'pending',
    blocked: blocks.length > 0,
    blockedByViewer: blocks.some((b) => b.blocker_id === viewerId),
  };
}

/**
 * Regla única de acceso a una actividad. Se usa en TODOS los endpoints que exponen actividades.
 */
export function canViewActivity(rel: Relation, ownerIsPrivate: boolean, visibility: 'public' | 'followers' | 'private'): boolean {
  if (rel.self) return true;
  if (rel.blocked) return false;
  if (visibility === 'private') return false;
  if (visibility === 'followers' || ownerIsPrivate) return rel.follower;
  return true;
}

/** Visibilidades que el espectador puede ver de un propietario dado. */
export function visibleLevels(rel: Relation, ownerIsPrivate: boolean): Array<'public' | 'followers' | 'private'> {
  if (rel.self) return ['public', 'followers', 'private'];
  if (rel.blocked) return [];
  if (rel.follower) return ['public', 'followers'];
  return ownerIsPrivate ? [] : ['public'];
}

export async function notify(
  db: Kysely<DB>,
  n: { userId: string; kind: string; actorId?: string | null; entityId?: string | null; data?: Record<string, unknown> },
) {
  if (n.actorId && n.actorId === n.userId) return;
  await db
    .insertInto('notifications')
    .values({ user_id: n.userId, kind: n.kind, actor_id: n.actorId ?? null, entity_id: n.entityId ?? null, data: JSON.stringify(n.data ?? {}) })
    .execute();
}

export function avatarUrl(userId: string, avatarPath: string | null, updatedAt?: Date): string | null {
  return avatarPath ? `/api/media/avatars/${userId}?v=${updatedAt ? updatedAt.getTime() : 0}` : null;
}

export interface UserCard {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export function userCard(u: { id: string; username: string; display_name: string; avatar_path: string | null; updated_at?: Date }): UserCard {
  return { id: u.id, username: u.username, displayName: u.display_name, avatarUrl: avatarUrl(u.id, u.avatar_path, u.updated_at) };
}
