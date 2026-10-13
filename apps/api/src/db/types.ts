import type { ColumnType, Generated, Insertable, Selectable } from 'kysely';

type Ts = ColumnType<Date, Date | string | undefined, Date | string>;
type TsNull = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
type Json<T> = ColumnType<T, string | T, string | T>;

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  username: string;
  display_name: string;
  bio: Generated<string>;
  location: Generated<string>;
  avatar_path: string | null;
  is_private: Generated<boolean>;
  units: Generated<'metric' | 'imperial'>;
  default_visibility: Generated<'public' | 'followers' | 'private'>;
  weight_kg: number | null;
  hr_max: number | null;
  hr_rest: number | null;
  ftp: number | null;
  role: Generated<'user' | 'moderator' | 'admin'>;
  suspended_at: TsNull;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface SessionsTable {
  id: Generated<string>;
  user_id: string;
  token_hash: Buffer;
  platform: Generated<string>;
  user_agent: string | null;
  created_at: Generated<Date>;
  last_used_at: Generated<Date>;
  expires_at: Ts;
}

export interface PasswordResetsTable {
  token_hash: Buffer;
  user_id: string;
  expires_at: Ts;
  used_at: TsNull;
}

export interface PrivacyZonesTable {
  id: Generated<string>;
  user_id: string;
  lat: number;
  lng: number;
  radius_m: number;
  label: Generated<string>;
  created_at: Generated<Date>;
}

export interface ActivitiesTable {
  id: string;
  owner_id: string;
  sport: string;
  name: string;
  description: Generated<string>;
  visibility: 'public' | 'followers' | 'private';
  source: 'recorded' | 'imported' | 'manual';
  started_at: Ts;
  timezone: string | null;
  elapsed_s: number;
  timer_s: number;
  moving_s: number;
  distance_m: Generated<number>;
  elev_gain_m: number | null;
  elev_loss_m: number | null;
  ele_min: number | null;
  ele_max: number | null;
  avg_speed: Generated<number>;
  max_speed: Generated<number>;
  avg_hr: number | null;
  max_hr: number | null;
  avg_power: number | null;
  max_power: number | null;
  avg_cadence: number | null;
  calories: number | null;
  rpe: number | null;
  training_load: number | null;
  device: string | null;
  polyline: string | null;
  public_polyline: string | null;
  min_lat: number | null;
  min_lng: number | null;
  max_lat: number | null;
  max_lng: number | null;
  start_lat: number | null;
  start_lng: number | null;
  stats: Json<Record<string, unknown>>;
  lap_marks: Generated<number[]>;
  pauses: Json<Array<[number, number]>>;
  version: Generated<number>;
  change_seq: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: TsNull;
}

export interface ActivityStreamsTable {
  activity_id: string;
  t: number[];
  lat: number[];
  lng: number[];
  ele: Array<number | null> | null;
  hr: Array<number | null> | null;
  power: Array<number | null> | null;
  cadence: Array<number | null> | null;
  seg: number[] | null;
}

export interface ActivityPhotosTable {
  id: Generated<string>;
  activity_id: string;
  owner_id: string;
  path: string;
  mime: string;
  bytes: number;
  created_at: Generated<Date>;
}

export interface FollowsTable {
  follower_id: string;
  followee_id: string;
  status: 'accepted' | 'pending';
  created_at: Generated<Date>;
}

export interface BlocksTable {
  blocker_id: string;
  blocked_id: string;
  created_at: Generated<Date>;
}

export interface ReactionsTable {
  activity_id: string;
  user_id: string;
  created_at: Generated<Date>;
}

export interface CommentsTable {
  id: Generated<string>;
  activity_id: string;
  author_id: string;
  body: string;
  created_at: Generated<Date>;
  deleted_at: TsNull;
}

export interface NotificationsTable {
  id: Generated<string>;
  user_id: string;
  kind: string;
  actor_id: string | null;
  entity_id: string | null;
  data: Json<Record<string, unknown>>;
  read_at: TsNull;
  created_at: Generated<Date>;
}

export interface ReportsTable {
  id: Generated<string>;
  reporter_id: string;
  target_type: 'user' | 'activity' | 'comment' | 'club';
  target_id: string;
  reason: string;
  details: Generated<string>;
  status: Generated<'open' | 'resolved' | 'dismissed'>;
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: TsNull;
  created_at: Generated<Date>;
}

export interface ClubsTable {
  id: Generated<string>;
  name: string;
  description: Generated<string>;
  sport: string | null;
  visibility: 'public' | 'private';
  owner_id: string;
  created_at: Generated<Date>;
}

export interface ClubMembersTable {
  club_id: string;
  user_id: string;
  role: Generated<'owner' | 'admin' | 'member'>;
  status: 'active' | 'invited' | 'requested';
  created_at: Generated<Date>;
}

export interface ChallengesTable {
  id: Generated<string>;
  title: string;
  description: Generated<string>;
  sport: string | null;
  metric: 'distance' | 'duration' | 'elevation' | 'count';
  target: number;
  starts_at: Ts;
  ends_at: Ts;
  club_id: string | null;
  created_by: string;
  created_at: Generated<Date>;
}

export interface ChallengeParticipantsTable {
  challenge_id: string;
  user_id: string;
  joined_at: Generated<Date>;
}

export interface SegmentsTable {
  id: Generated<string>;
  name: string;
  sport_group: string;
  creator_id: string | null;
  source_activity_id: string | null;
  lat: number[];
  lng: number[];
  ele: Array<number | null> | null;
  distance_m: number;
  elev_gain_m: number | null;
  min_lat: number;
  min_lng: number;
  max_lat: number;
  max_lng: number;
  created_at: Generated<Date>;
  deleted_at: TsNull;
}

export interface SegmentEffortsTable {
  id: Generated<string>;
  segment_id: string;
  activity_id: string;
  user_id: string;
  started_at: Ts;
  elapsed_s: number;
  distance_m: number;
  avg_hr: number | null;
  start_index: number;
  end_index: number;
  flagged: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface GoalsTable {
  id: Generated<string>;
  user_id: string;
  period: 'week' | 'month' | 'year';
  metric: 'distance' | 'duration' | 'elevation' | 'count';
  sport: string | null;
  target: number;
  created_at: Generated<Date>;
  archived_at: TsNull;
}

export interface RoutesTable {
  id: string;
  owner_id: string;
  name: string;
  sport: string;
  description: Generated<string>;
  visibility: 'public' | 'followers' | 'private';
  waypoints: Json<Array<{ lat: number; lng: number; name?: string }>>;
  lat: number[];
  lng: number[];
  ele: Array<number | null> | null;
  distance_m: number;
  elev_gain_m: number | null;
  routed: Generated<boolean>;
  favorite: Generated<boolean>;
  version: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: TsNull;
}

export interface PlanEnrollmentsTable {
  id: Generated<string>;
  user_id: string;
  plan_key: string;
  start_date: ColumnType<string, string, string>;
  created_at: Generated<Date>;
  ended_at: TsNull;
}

export interface BillingCustomersTable {
  user_id: string;
  stripe_customer_id: string | null;
}

export interface SubscriptionsTable {
  id: Generated<string>;
  user_id: string;
  provider: 'stripe' | 'google_play';
  provider_ref: string;
  plan: string;
  status: string;
  current_period_end: TsNull;
  cancel_at_period_end: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface BillingEventsTable {
  provider: string;
  event_id: string;
  type: string;
  received_at: Generated<Date>;
}

export interface DB {
  users: UsersTable;
  sessions: SessionsTable;
  password_resets: PasswordResetsTable;
  privacy_zones: PrivacyZonesTable;
  activities: ActivitiesTable;
  activity_streams: ActivityStreamsTable;
  activity_photos: ActivityPhotosTable;
  follows: FollowsTable;
  blocks: BlocksTable;
  reactions: ReactionsTable;
  comments: CommentsTable;
  notifications: NotificationsTable;
  reports: ReportsTable;
  clubs: ClubsTable;
  club_members: ClubMembersTable;
  challenges: ChallengesTable;
  challenge_participants: ChallengeParticipantsTable;
  segments: SegmentsTable;
  segment_efforts: SegmentEffortsTable;
  goals: GoalsTable;
  routes: RoutesTable;
  plan_enrollments: PlanEnrollmentsTable;
  billing_customers: BillingCustomersTable;
  subscriptions: SubscriptionsTable;
  billing_events: BillingEventsTable;
}

export type User = Selectable<UsersTable>;
export type Activity = Selectable<ActivitiesTable>;
export type NewActivity = Insertable<ActivitiesTable>;
