/**
 * Reserved top-level key prefix, kept free for future internal objects
 * (thumbnails, exports). Keys under it are never listed, served via `/f/`,
 * or touched by repair, and folders cannot be created there.
 */
export const RESERVED_PREFIX = "_";

/** Login JWT lifetime in seconds. */
export const TOKEN_TTL_SECONDS = 7 * 24 * 3600;

/**
 * `iss` claim written and verified on every session token. It costs nothing
 * and stops a token minted by some other app that happens to share the secret
 * from being accepted here.
 */
export const JWT_ISSUER = "picnest";

/** Share token length (nanoid). */
export const SHARE_TOKEN_LENGTH = 16;

/**
 * How deep a folder path may nest. `ensureFolders` inserts a path and all its
 * ancestors in one statement, one bound parameter each, and D1 allows 100 per
 * query — without a cap, the 512-character path limit permits 256 segments and
 * the insert fails on the platform limit rather than on anything meaningful.
 */
export const MAX_FOLDER_DEPTH = 32;

/**
 * Sequential `-2`, `-3`, … attempts before a colliding display name falls back
 * to a random suffix. Each attempt is one D1 query and a Worker on the free
 * plan gets 50 per invocation, so counting all the way up is not affordable:
 * forty files sharing a name in one folder would spend the whole budget
 * proving it. `photo-a7f31c.png` is a fine answer at that point.
 */
export const NAME_COLLISION_ATTEMPTS = 5;

/** Random-suffix attempts once the sequential ones are used up. */
export const RANDOM_NAME_ATTEMPTS = 3;

/**
 * Object keys `/f/` will serve: the full SHA-256 hex digest of the content
 * plus the canonical extension the format sniffer assigned. Anything else in
 * the bucket — an object dropped in by hand, a future internal export — is not
 * reachable through the public link route.
 */
export const CONTENT_KEY_RE = /^[a-f0-9]{64}\.(avif|gif|jpg|png|webp)$/;

/**
 * Largest accepted upload. The whole body is buffered to hash it, and a
 * Worker isolate has 128 MB of memory, so this stays well clear of it.
 */
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

/**
 * PBKDF2 rounds for share passwords, sized against the CPU budget rather than
 * against the OWASP figure for a login system.
 *
 * The derivation is synchronous native work inside a single request, and a
 * Worker on the free plan gets 10 ms of CPU per invocation. Measured on an
 * Apple-silicon laptop: 100,000 rounds costs ~11.8 ms, 50,000 ~5.9 ms, 25,000
 * ~3 ms. Edge hardware is slower, so anything near six figures does not merely
 * run hot — it gets the request killed, and the unlock page stops working.
 *
 * That trade is acceptable here because iteration count is not what defends
 * this. `SHARE_LIMITER` stops online guessing at 10 tries a minute per IP and
 * token; the per-share salt is what a leaked `shares` table runs into. The
 * work factor only buys time on top of the salt.
 *
 * Raise it if you are on a paid plan (30 s of CPU) and want the extra margin.
 */
export const SHARE_PBKDF2_ITERATIONS = 25_000;

/** Longest accepted share password. */
export const MAX_SHARE_PASSWORD_LENGTH = 128;

/** Longest accepted share lifetime, in hours (one year). */
export const MAX_SHARE_HOURS = 365 * 24;

/**
 * How long one correct password entry keeps a share open, in seconds. Short
 * enough that a borrowed browser does not hand the image over tomorrow, long
 * enough to read the page and save the file.
 */
export const SHARE_UNLOCK_TTL_SECONDS = 15 * 60;
