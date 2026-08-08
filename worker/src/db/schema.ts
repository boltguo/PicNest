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
 * R2 is the source of truth for file BYTES; this database is the source of
 * truth for everything else — names, folders, which logical files exist, and
 * share links. Neither half reconstructs the other, and a full backup is both
 * of them. `POST /api/repair` reconciles the two, it does not restore one
 * from the other; point-in-time recovery here is D1 Time Travel.
 *
 * Objects are content-addressed — the key is the SHA-256 of the bytes plus
 * the extension the format sniffer assigned, never the file name — so a link
 * is stable and can never serve different bytes than it did yesterday. It is
 * not secret: anyone holding the same image can compute it, which is why `/f/`
 * is defined as a permanent public link and `/s/` is where access control
 * lives.
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
    /** R2 object key: `<sha256 hex><ext>`. Shared by identical content. */
    key: text("key").notNull(),
    /** Folder path without trailing slash; empty string means root. */
    folder: text("folder").notNull().default(""),
    /** Display name including extension. Unique within its folder. */
    name: text("name").notNull(),
    size: integer("size").notNull(),
    mime: text("mime").notNull().default("application/octet-stream"),
    /**
     * Full SHA-256 hex of the content; `key` is this plus an extension. Kept
     * for integrity checks. Deliberately unindexed — nothing queries it, and
     * lookups go through `key`.
     */
    hash: text("hash"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    // Keeps move/rename honest and makes "name taken?" a single lookup.
    uniqueIndex("idx_files_folder_name").on(t.folder, t.name),
    // One image, one card. The upload route checks for a duplicate before
    // inserting, but two parallel uploads of the same photo can both pass
    // that check; this is what actually decides it.
    uniqueIndex("idx_files_folder_key").on(t.folder, t.key),
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
    /** `pbkdf2-sha256$<iterations>$<salt>$<hash>`; null = no password. */
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
