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
 * of them. `POST /api/repair` scans for discrepancies without removing
 * records; importing unindexed objects is a separate explicit operation.
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
 * that no other row still points at the key (see `cleanObjects`).
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
    width: integer("width"),
    height: integer("height"),
    thumbnailKey: text("thumbnail_key"),
    missing: integer("missing").notNull().default(0),
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
    index("idx_files_folder_created_id").on(t.folder, t.createdAt, t.id),
    index("idx_files_folder_size_id").on(t.folder, t.size, t.id),
  ],
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
  (t) => [index("idx_shares_file_id").on(t.fileId)],
);

export type FileRow = typeof files.$inferSelect;
export type FolderRow = typeof folders.$inferSelect;
export type ShareRow = typeof shares.$inferSelect;

/** Durable cleanup intentions also prevent repair from resurrecting deletions. */
export const tombstones = sqliteTable("object_tombstones", {
  key: text("key").primaryKey(),
  pending: integer("pending").notNull().default(1),
  createdAt: integer("created_at").notNull(),
});

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["delete-folder", "repair"] }).notNull(),
    path: text("path").notNull().default(""),
    status: text("status", { enum: ["running", "done", "error"] })
      .notNull()
      .default("running"),
    phase: text("phase").notNull().default("files"),
    cursor: text("cursor").notNull().default("0"),
    processed: integer("processed").notNull().default(0),
    total: integer("total").notNull().default(0),
    error: text("error"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("idx_jobs_status").on(t.status)],
);

export const findings = sqliteTable(
  "repair_findings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    kind: text("kind", { enum: ["missing", "unindexed"] }).notNull(),
    name: text("name").notNull(),
    folder: text("folder").notNull(),
    resolved: integer("resolved").notNull().default(0),
  },
  (t) => [uniqueIndex("idx_findings_job_key_kind").on(t.jobId, t.key, t.kind)],
);
