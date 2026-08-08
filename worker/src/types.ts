import type { JwtVariables } from "hono/jwt";

export type Bindings = {
  /** R2 bucket — source of truth for file bytes. */
  BUCKET: R2Bucket;
  /** D1 database — source of truth for names, folders and share links. */
  DB: D1Database;
  /** Static assets (web/dist, SPA fallback). */
  ASSETS: Fetcher;
  /** Admin password; set via `wrangler secret put ADMIN_PASSWORD`. */
  ADMIN_PASSWORD: string;
  /**
   * HMAC key for session tokens and share unlock cookies. Must be random —
   * never the admin password. RFC 8725 §3.5: a human-chosen string used as an
   * HS256 key turns any captured token into an offline dictionary attack.
   */
  JWT_SECRET: string;
  /** Throttles password guesses on /api/login. Configured in wrangler.jsonc. */
  LOGIN_LIMITER: RateLimit;
  /** Throttles password guesses on a share link, per IP and token. */
  SHARE_LIMITER: RateLimit;
};

export type AppEnv = { Bindings: Bindings; Variables: JwtVariables };
