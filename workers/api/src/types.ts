import type { CityDispatchDO } from './durable-objects/CityDispatchDO';
import type { OrderStreamDO } from './durable-objects/OrderStreamDO';
import type { RiderStreamDO } from './durable-objects/RiderStreamDO';
import type { HeatmapDO } from './durable-objects/HeatmapDO';
import type { RateLimitDO } from './durable-objects/RateLimitDO';
import type { SessionDO } from './durable-objects/SessionDO';
import type { LockDO } from './durable-objects/LockDO';

export interface DomainEvent {
  topic: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

export interface AuthClaims {
  user_id: string;
  role: string;
  phone?: string;
  email?: string;
  city_scope?: string;
  two_factor_pending?: boolean;
  must_change_password?: boolean;
  phone_verified?: boolean;
  sub?: string;
  exp?: number;
  iat?: number;
  iss?: string;
  jti?: string;
}

export interface Env {
  // Bindings
  HYPERDRIVE: Hyperdrive;
  HYPERDRIVE_RW?: Hyperdrive;
  DATABASE_URL?: string;
  DOCS?: R2Bucket;
  CONFIG: KVNamespace;
  EVENTS: Queue<DomainEvent>;

  // Neon Object Storage (S3-compatible)
  S3_ENDPOINT?: string;
  S3_BUCKET?: string;
  S3_REGION?: string;
  AWS_ENDPOINT_URL_S3?: string;
  AWS_REGION?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;

  // Durable Objects
  CITY_DISPATCH_DO: DurableObjectNamespace<CityDispatchDO>;
  ORDER_STREAM_DO: DurableObjectNamespace<OrderStreamDO>;
  RIDER_STREAM_DO: DurableObjectNamespace<RiderStreamDO>;
  HEATMAP_DO: DurableObjectNamespace<HeatmapDO>;
  RATE_LIMIT_DO: DurableObjectNamespace<RateLimitDO>;
  SESSION_DO: DurableObjectNamespace<SessionDO>;
  LOCK_DO: DurableObjectNamespace<LockDO>;

  // Secrets & Config Variables
  JWT_SECRET_SIGNING_KEY: string;
  FIELD_ENCRYPTION_KEY: string;
  STYTCH_PROJECT_ID?: string;
  STYTCH_SECRET?: string;
  STYTCH_PUBLIC_TOKEN?: string;
  STYTCH_ENV?: string;
  STYTCH_BASE_URL?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  APPLE_OAUTH_CLIENT_ID?: string;
  APPLE_OAUTH_TEAM_ID?: string;
  APPLE_OAUTH_KEY_ID?: string;
  APPLE_OAUTH_PRIVATE_KEY?: string;
  FIREBASE_PROJECT_ID: string;
  FCM_SERVICE_ACCOUNT_JSON?: string;
  GOOGLE_MAPS_API_KEY?: string;
  PAYMENT_WEBHOOK_SIGNING_SECRET?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  SENTRY_DSN?: string;
  ACCESS_TOKEN_TTL: string;
  ALLOWED_ORIGINS: string;
  ADMIN_COOKIE_SAMESITE: string;
  ADMIN_FRONTEND_URL: string;
  APP_VERSION: string;
  OSRM_BASE_URL?: string;
  NOMINATIM_BASE_URL?: string;
  CITY_PREFIX: string;
  DEFAULT_CITY_PREFIX: string;
  SUPPORTED_REGIONS: string;
  SURGE_TRACKED_CELLS: string;
}
