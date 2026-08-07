export type Bindings = {
  /** R2 bucket — single source of truth for file bytes. */
  BUCKET: R2Bucket;
  /** D1 database — rebuildable metadata index (files/folders/shares). */
  DB: D1Database;
  /** Static assets (web/dist, SPA fallback). */
  ASSETS: Fetcher;
  /** Admin password; set via `wrangler secret put ADMIN_PASSWORD`. */
  ADMIN_PASSWORD: string;
  /** Throttles password guesses on /api/login. Configured in wrangler.jsonc. */
  LOGIN_LIMITER: RateLimit;
};

export type AppEnv = { Bindings: Bindings };
