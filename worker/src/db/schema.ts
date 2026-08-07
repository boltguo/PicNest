import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Design notes
 *
 * R2 is the single source of truth for file bytes. Objects are
 * content-addressed — the key is a SHA-256 prefix, never the file name —
 * so a link is stable, unguessable, and can never serve different bytes
 * than it did yesterday. The display name and folder are presentation
 * only and live here; each object also carries them in its R2
 * customMetadata so a lost database can be rebuilt (see reconcile).
 *
 * Because the key is derived from content, the same image filed in two
 * folders is ONE object with TWO rows. `key` is therefore not unique and
 * is not a row identifier — use `id`. Deleting bytes requires checking
 * that no other row still points at the key (see `deleteFileRows`).
 *
 * Timestamps are epoch milliseconds (UTC) stored as integers.
 */

export const files = sqliteTable(
  "files",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** R2 object key: `<sha256 prefix><ext>`. Shared by identical content. */
    key: text("key").notNull(),
    /** Folder path without trailing slash; empty string means root. */
    folder: text("folder").notNull().default(""),
    /** Display name including extension. Unique within its folder. */
    name: text("name").notNull(),
    size: integer("size").notNull(),
    mime: text("mime").notNull().default("application/octet-stream"),
    /**
     * Full SHA-256 hex of the content; `key` is a prefix of it. Kept for
     * integrity checks and future cross-extension dedup. Deliberately
     * unindexed — nothing queries it yet, and lookups go through `key`.
     */
    hash: text("hash"),
    /** Image dimensions; reserved for gallery layout / thumbnails. */
    width: integer("width"),
    height: integer("height"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    // Keeps move/rename honest and makes "name taken?" a single lookup.
    uniqueIndex("idx_files_folder_name").on(t.folder, t.name),
    index("idx_files_folder").on(t.folder),
    index("idx_files_created_at").on(t.createdAt),
    index("idx_files_key").on(t.key),
  ]
);

export const folders = sqliteTable("folders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Full path, e.g. `wallpapers/mac`; no leading/trailing slash. */
  path: text("path").notNull().unique(),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const shares = sqliteTable(
  "shares",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    token: text("token").notNull().unique(),
    fileId: integer("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    /** SHA-256 hex of the access password; null = no password. */
    passwordHash: text("password_hash"),
    /** Epoch ms; null = never expires. */
    expiresAt: integer("expires_at"),
    visits: integer("visits").notNull().default(0),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("idx_shares_file_id").on(t.fileId)]
);

export type FileRow = typeof files.$inferSelect;
export type FolderRow = typeof folders.$inferSelect;
export type ShareRow = typeof shares.$inferSelect;
