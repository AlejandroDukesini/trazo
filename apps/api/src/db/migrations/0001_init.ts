import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>) {
  await sql`
create extension if not exists citext;

create table users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  password_hash text not null,
  username citext not null unique,
  display_name text not null,
  bio text not null default '',
  location text not null default '',
  avatar_path text,
  is_private boolean not null default false,
  units text not null default 'metric' check (units in ('metric','imperial')),
  default_visibility text not null default 'followers' check (default_visibility in ('public','followers','private')),
  weight_kg real,
  hr_max smallint,
  hr_rest smallint,
  ftp smallint,
  role text not null default 'user' check (role in ('user','moderator','admin')),
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash bytea not null unique,
  platform text not null default 'web',
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user on sessions(user_id);

create table password_resets (
  token_hash bytea primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table privacy_zones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  radius_m real not null,
  label text not null default '',
  created_at timestamptz not null default now()
);
create index privacy_zones_user on privacy_zones(user_id);

create sequence activity_change_seq;

create table activities (
  id uuid primary key,
  owner_id uuid not null references users(id) on delete cascade,
  sport text not null,
  name text not null,
  description text not null default '',
  visibility text not null check (visibility in ('public','followers','private')),
  source text not null check (source in ('recorded','imported','manual')),
  started_at timestamptz not null,
  timezone text,
  elapsed_s integer not null,
  timer_s integer not null,
  moving_s integer not null,
  distance_m double precision not null default 0,
  elev_gain_m real,
  elev_loss_m real,
  ele_min real,
  ele_max real,
  avg_speed real not null default 0,
  max_speed real not null default 0,
  avg_hr smallint,
  max_hr smallint,
  avg_power smallint,
  max_power smallint,
  avg_cadence smallint,
  calories integer,
  rpe smallint,
  training_load integer,
  device text,
  polyline text,
  public_polyline text,
  min_lat double precision, min_lng double precision, max_lat double precision, max_lng double precision,
  start_lat double precision, start_lng double precision,
  stats jsonb not null default '{}',
  lap_marks integer[] not null default '{}',
  pauses jsonb not null default '[]',
  version integer not null default 1,
  change_seq bigint not null default nextval('activity_change_seq'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index activities_owner_started on activities(owner_id, started_at desc, id desc) where deleted_at is null;
create index activities_owner_seq on activities(owner_id, change_seq);
create index activities_started on activities(started_at desc, id desc) where deleted_at is null;

create table activity_streams (
  activity_id uuid primary key references activities(id) on delete cascade,
  t integer[] not null,
  lat double precision[] not null,
  lng double precision[] not null,
  ele real[],
  hr smallint[],
  power smallint[],
  cadence smallint[],
  seg integer[]
);

create table activity_photos (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities(id) on delete cascade,
  owner_id uuid not null references users(id) on delete cascade,
  path text not null,
  mime text not null,
  bytes integer not null,
  created_at timestamptz not null default now()
);
create index activity_photos_activity on activity_photos(activity_id);

create table follows (
  follower_id uuid not null references users(id) on delete cascade,
  followee_id uuid not null references users(id) on delete cascade,
  status text not null check (status in ('accepted','pending')),
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee on follows(followee_id, status);

create table blocks (
  blocker_id uuid not null references users(id) on delete cascade,
  blocked_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);
create index blocks_blocked on blocks(blocked_id);

create table reactions (
  activity_id uuid not null references activities(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (activity_id, user_id)
);

create table comments (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities(id) on delete cascade,
  author_id uuid not null references users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index comments_activity on comments(activity_id, created_at);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,
  actor_id uuid references users(id) on delete cascade,
  entity_id text,
  data jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user on notifications(user_id, created_at desc);

create table reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references users(id) on delete cascade,
  target_type text not null check (target_type in ('user','activity','comment','club')),
  target_id text not null,
  reason text not null,
  details text not null default '',
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  resolution text,
  resolved_by uuid references users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index reports_status on reports(status, created_at);

create table clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  sport text,
  visibility text not null check (visibility in ('public','private')),
  owner_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table club_members (
  club_id uuid not null references clubs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  status text not null check (status in ('active','invited','requested')),
  created_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
create index club_members_user on club_members(user_id, status);

create table challenges (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  sport text,
  metric text not null check (metric in ('distance','duration','elevation','count')),
  target double precision not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  club_id uuid references clubs(id) on delete cascade,
  created_by uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index challenges_dates on challenges(ends_at);

create table challenge_participants (
  challenge_id uuid not null references challenges(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);
create index challenge_participants_user on challenge_participants(user_id);

create table segments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sport_group text not null,
  creator_id uuid references users(id) on delete set null,
  source_activity_id uuid,
  lat double precision[] not null,
  lng double precision[] not null,
  ele real[],
  distance_m real not null,
  elev_gain_m real,
  min_lat double precision not null, min_lng double precision not null,
  max_lat double precision not null, max_lng double precision not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index segments_bbox on segments(min_lat, max_lat, min_lng, max_lng) where deleted_at is null;

create table segment_efforts (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references segments(id) on delete cascade,
  activity_id uuid not null references activities(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  started_at timestamptz not null,
  elapsed_s real not null,
  distance_m real not null,
  avg_hr smallint,
  start_index integer not null,
  end_index integer not null,
  flagged boolean not null default false,
  created_at timestamptz not null default now(),
  unique (segment_id, activity_id, start_index)
);
create index segment_efforts_board on segment_efforts(segment_id, elapsed_s) where not flagged;
create index segment_efforts_activity on segment_efforts(activity_id);
create index segment_efforts_user on segment_efforts(user_id, segment_id);

create table goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  period text not null check (period in ('week','month','year')),
  metric text not null check (metric in ('distance','duration','elevation','count')),
  sport text,
  target double precision not null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index goals_user on goals(user_id) where archived_at is null;

create table routes (
  id uuid primary key,
  owner_id uuid not null references users(id) on delete cascade,
  name text not null,
  sport text not null,
  description text not null default '',
  visibility text not null check (visibility in ('public','followers','private')),
  waypoints jsonb not null,
  lat double precision[] not null,
  lng double precision[] not null,
  ele real[],
  distance_m real not null,
  elev_gain_m real,
  routed boolean not null default false,
  favorite boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index routes_owner on routes(owner_id, updated_at desc) where deleted_at is null;

create table plan_enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  plan_key text not null,
  start_date date not null,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create index plan_enrollments_user on plan_enrollments(user_id) where ended_at is null;

create table billing_customers (
  user_id uuid primary key references users(id) on delete cascade,
  stripe_customer_id text unique
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null check (provider in ('stripe','google_play')),
  provider_ref text not null,
  plan text not null,
  status text not null,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_ref)
);
create index subscriptions_user on subscriptions(user_id);

create table billing_events (
  provider text not null,
  event_id text not null,
  type text not null,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);
`.execute(db);
}
