import { z } from 'zod';
import { SPORT_KEYS } from './sports.js';

export const MAX_STREAM_POINTS = 200_000;

export const VisibilitySchema = z.enum(['public', 'followers', 'private']);
export type Visibility = z.infer<typeof VisibilitySchema>;

export const SportSchema = z.string().refine((s) => SPORT_KEYS.includes(s), 'Deporte no válido');

export const ActivitySourceSchema = z.enum(['recorded', 'imported', 'manual']);
export type ActivitySource = z.infer<typeof ActivitySourceSchema>;

const nullableNum = (min: number, max: number) => z.array(z.number().min(min).max(max).nullable());

/**
 * Recorrido en formato columnar (compacto y rápido de procesar).
 * `t`: milisegundos desde `startedAt`. `seg`: índice de tramo; cambia tras cada pausa
 * o pérdida prolongada de señal, y la distancia nunca se acumula entre tramos.
 */
export const StreamSchema = z
  .object({
    t: z.array(z.number().int().min(0)).max(MAX_STREAM_POINTS),
    lat: z.array(z.number().min(-90).max(90)),
    lng: z.array(z.number().min(-180).max(180)),
    ele: nullableNum(-500, 9000).optional(),
    hr: nullableNum(20, 250).optional(),
    power: nullableNum(0, 3000).optional(),
    cadence: nullableNum(0, 300).optional(),
    seg: z.array(z.number().int().min(0)).optional(),
  })
  .superRefine((s, ctx) => {
    const n = s.t.length;
    for (const k of ['lat', 'lng', 'ele', 'hr', 'power', 'cadence', 'seg'] as const) {
      const arr = s[k];
      if (arr && arr.length !== n) ctx.addIssue({ code: 'custom', message: `Longitud de ${k} inconsistente`, path: [k] });
    }
    for (let i = 1; i < n; i++) {
      if (s.t[i]! < s.t[i - 1]!) {
        ctx.addIssue({ code: 'custom', message: 'Marcas de tiempo no ordenadas', path: ['t', i] });
        break;
      }
    }
  });
export type Stream = z.infer<typeof StreamSchema>;

export const ActivityCreateSchema = z
  .object({
    id: z.uuid(),
    sport: SportSchema,
    name: z.string().trim().min(1).max(120),
    description: z.string().max(4000).default(''),
    visibility: VisibilitySchema.default('followers'),
    startedAt: z.iso.datetime({ offset: true }),
    timezone: z.string().max(64).optional(),
    source: ActivitySourceSchema,
    /** Tiempo total de pared (incluye pausas), segundos. */
    elapsedS: z.number().int().min(1).max(14 * 24 * 3600),
    /** Para actividades manuales: valores declarados por el usuario. */
    distanceM: z.number().min(0).max(2_000_000).optional(),
    movingS: z.number().int().min(0).optional(),
    elevGainM: z.number().min(0).max(30_000).optional(),
    rpe: z.number().int().min(1).max(10).nullable().optional(),
    lapMarks: z.array(z.number().int().min(0)).max(1000).default([]),
    pauses: z.array(z.tuple([z.number().int().min(0), z.number().int().min(0)])).max(5000).default([]),
    device: z.string().max(80).optional(),
    stream: StreamSchema.optional(),
  })
  .superRefine((a, ctx) => {
    if (a.source !== 'manual' && !a.stream) {
      ctx.addIssue({ code: 'custom', message: 'Las actividades grabadas o importadas requieren recorrido', path: ['stream'] });
    }
  });
export type ActivityCreate = z.input<typeof ActivityCreateSchema>;

export const ActivityPatchSchema = z.object({
  baseVersion: z.number().int().min(1),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(4000).optional(),
  visibility: VisibilitySchema.optional(),
  sport: SportSchema.optional(),
  rpe: z.number().int().min(1).max(10).nullable().optional(),
});
export type ActivityPatch = z.infer<typeof ActivityPatchSchema>;

export const UsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(30)
  .regex(/^[a-z0-9_.]+$/, 'Solo letras, números, punto y guion bajo');

export const PasswordSchema = z.string().min(10, 'Mínimo 10 caracteres').max(200);

export const RegisterSchema = z.object({
  email: z.email().max(254).transform((e) => e.toLowerCase()),
  password: PasswordSchema,
  username: UsernameSchema,
  displayName: z.string().trim().min(1).max(60),
});

export const LoginSchema = z.object({
  email: z.email().max(254).transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(200),
});

export const ProfilePatchSchema = z.object({
  displayName: z.string().trim().min(1).max(60).optional(),
  bio: z.string().max(500).optional(),
  location: z.string().max(80).optional(),
  isPrivate: z.boolean().optional(),
  units: z.enum(['metric', 'imperial']).optional(),
  defaultVisibility: VisibilitySchema.optional(),
  weightKg: z.number().min(25).max(300).nullable().optional(),
  hrMax: z.number().int().min(100).max(230).nullable().optional(),
  hrRest: z.number().int().min(30).max(120).nullable().optional(),
  ftp: z.number().int().min(50).max(600).nullable().optional(),
});
export type ProfilePatch = z.infer<typeof ProfilePatchSchema>;

export const PrivacyZoneSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusM: z.number().min(100).max(2000),
  label: z.string().max(40).default(''),
});
export type PrivacyZoneInput = z.infer<typeof PrivacyZoneSchema>;

export const CommentSchema = z.object({ body: z.string().trim().min(1).max(1000) });

export const GoalSchema = z.object({
  period: z.enum(['week', 'month', 'year']),
  metric: z.enum(['distance', 'duration', 'elevation', 'count']),
  sport: SportSchema.nullable().default(null),
  target: z.number().positive().max(1e8),
});
export type GoalInput = z.infer<typeof GoalSchema>;

export const ClubSchema = z.object({
  name: z.string().trim().min(3).max(60),
  description: z.string().max(1000).default(''),
  sport: SportSchema.nullable().default(null),
  visibility: z.enum(['public', 'private']).default('public'),
});

export const ChallengeSchema = z
  .object({
    title: z.string().trim().min(3).max(80),
    description: z.string().max(1000).default(''),
    sport: SportSchema.nullable().default(null),
    metric: z.enum(['distance', 'duration', 'elevation', 'count']),
    target: z.number().positive().max(1e8),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    clubId: z.uuid().nullable().default(null),
  })
  .refine((c) => new Date(c.endsAt) > new Date(c.startsAt), { message: 'La fecha de fin debe ser posterior', path: ['endsAt'] });

export const ReportSchema = z.object({
  targetType: z.enum(['user', 'activity', 'comment', 'club']),
  targetId: z.string().min(1).max(64),
  reason: z.enum(['spam', 'abuse', 'inappropriate', 'fraud', 'privacy', 'other']),
  details: z.string().max(1000).default(''),
});

export const RouteSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(120),
  sport: SportSchema,
  description: z.string().max(2000).default(''),
  visibility: VisibilitySchema.default('private'),
  waypoints: z.array(z.object({ lat: z.number(), lng: z.number(), name: z.string().max(80).optional() })).min(2).max(100),
  geometry: z.object({
    lat: z.array(z.number().min(-90).max(90)).max(50_000),
    lng: z.array(z.number().min(-180).max(180)).max(50_000),
    ele: z.array(z.number().nullable()).max(50_000).optional(),
  }),
  routed: z.boolean().default(false),
  favorite: z.boolean().default(false),
});
export type RouteInput = z.input<typeof RouteSchema>;

export const SegmentCreateSchema = z.object({
  activityId: z.uuid(),
  startIndex: z.number().int().min(0),
  endIndex: z.number().int().min(1),
  name: z.string().trim().min(3).max(80),
});
