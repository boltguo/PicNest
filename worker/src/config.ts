/**
 * Reserved top-level key prefix, kept free for future internal objects
 * (thumbnails, exports). Keys under it are never listed, served via `/f/`,
 * or touched by reconcile, and folders cannot be created there.
 */
export const RESERVED_PREFIX = "_";

/** Login JWT lifetime in seconds. */
export const TOKEN_TTL_SECONDS = 7 * 24 * 3600;

/** Share token length (nanoid). */
export const SHARE_TOKEN_LENGTH = 16;

/** Max attempts to find a free display name when one collides in a folder. */
export const NAME_COLLISION_ATTEMPTS = 100;

/**
 * Hex characters of the SHA-256 content digest used as the object key.
 * 24 hex = 96 bits: far past the birthday bound for any personal library,
 * while keeping links short. The full digest still lives in `files.hash`.
 */
export const CONTENT_KEY_HEX = 24;

/**
 * Largest accepted upload. The whole body is buffered to hash it, and a
 * Worker isolate has 128 MB of memory, so this stays well clear of it.
 */
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

/**
 * Accepted upload content types. This is an image host and the dropzone
 * already filters to `image/*`; enforcing it server-side keeps documents
 * and scripts out of a bucket whose objects are served from this origin.
 */
export const ACCEPTED_MIME = /^image\/[a-z0-9][a-z0-9.+-]*$/i;
