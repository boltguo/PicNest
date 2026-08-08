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

/** Max attempts to find a free display name when one collides in a folder. */
export const NAME_COLLISION_ATTEMPTS = 100;

/**
 * Object keys `/f/` will serve: the full SHA-256 hex digest of the content
 * plus the extension the format sniffer assigned. Anything else in the bucket
 * — an object dropped in by hand, a future internal export — is not reachable
 * through the public link route.
 *
 * The 24-hex lower bound accepts keys minted before the digest was stored in
 * full, so links handed out then keep working.
 */
export const CONTENT_KEY_RE = /^[a-f0-9]{24,64}\.(avif|gif|jpe?g|png|webp)$/;

/**
 * Largest accepted upload. The whole body is buffered to hash it, and a
 * Worker isolate has 128 MB of memory, so this stays well clear of it.
 */
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

/**
 * PBKDF2 rounds for share passwords. The whole derivation runs inside one
 * request, and a Worker on the free plan gets 10 ms of CPU per invocation,
 * so this is deliberately far below the OWASP figure for a login system —
 * `SHARE_LIMITER` is what actually stops online guessing, and the salt plus
 * the work factor are here for the case where the D1 rows leak.
 *
 * Raise it if you are on a paid plan and have measured the headroom.
 */
export const SHARE_PBKDF2_ITERATIONS = 100_000;

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
