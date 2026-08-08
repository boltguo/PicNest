import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { CONTENT_KEY_RE, MAX_UPLOAD_BYTES } from "../config";
import { createDb, files, folders, type Db } from "../db";
import { requireAuth } from "../lib/auth";
import { deleteFileRows, insertFileRow, isKeyTaken } from "../lib/files";
import { sha256Hex } from "../lib/hash";
import { detectImage, withImageExtension } from "../lib/image";
import {
  contentKey,
  ensureFolders,
  folderSchema,
  resolveUniqueName,
  sanitizeFileName,
  subtreePattern,
} from "../lib/paths";
import { serveObject } from "../lib/r2";
import type { AppEnv } from "../types";

/** How many recent images peek out of a folder card. */
const FOLDER_PREVIEW_LIMIT = 5;

/** True if `path` sits directly inside `parent` ("" = root). */
const isDirectChild = (path: string, parent: string) =>
  parent === ""
    ? !path.includes("/")
    : path.startsWith(`${parent}/`) &&
      !path.slice(parent.length + 1).includes("/");

interface FolderStats {
  /** Recent image keys, newest first. */
  previews: string[];
  /** Files anywhere in the subtree. */
  count: number;
}

/**
 * Preview keys and file counts for every direct child of `parent`, in one
 * query.
 *
 * This used to be two queries per child folder. A Worker on the free plan
 * gets 50 D1 queries per invocation, so a library with two dozen folders at
 * one level was a couple of `New folder` clicks away from failing to list
 * anything at all — not a performance nicety, a ceiling.
 *
 * The window functions do the per-child work that the loop used to: partition
 * every descendant row by the path segment that names its top-level child,
 * then take that partition's size and its five newest rows. The `copy = 1`
 * filter drops repeats of one object — the same photo filed twice in a
 * subtree is two files but only one thing worth showing on the card — and
 * runs after the count so `total` stays a file count.
 */
async function childFolderStats(
  db: Db,
  parent: string
): Promise<Map<string, FolderStats>> {
  // Everything strictly under `parent`; each such row belongs to exactly one
  // direct child, and their union is every file the children hold.
  const scope =
    parent === ""
      ? sql`${files.folder} <> ''`
      : sql`${files.folder} LIKE ${subtreePattern(parent)} ESCAPE '\\'`;
  // 1-based, and `parent/` is one longer than `parent`.
  const relative = sql`substr(${files.folder}, ${parent === "" ? 1 : parent.length + 2})`;

  const rows = await db.all<{ child: string; key: string; total: number }>(sql`
    select child, key, total from (
      select
        child, key, total,
        row_number() over (
          partition by child order by created_at desc, id desc
        ) as rn
      from (
        select
          child, key, created_at, id,
          count(*) over (partition by child) as total,
          row_number() over (
            partition by child, key order by created_at desc, id desc
          ) as copy
        from (
          select
            ${files.key} as key,
            ${files.createdAt} as created_at,
            ${files.id} as id,
            case
              when instr(${relative}, '/') > 0
                then substr(${relative}, 1, instr(${relative}, '/') - 1)
              else ${relative}
            end as child
          from ${files}
          where ${scope}
        )
      )
      where copy = 1
    )
    where rn <= ${FOLDER_PREVIEW_LIMIT}
  `);

  const stats = new Map<string, FolderStats>();
  for (const row of rows) {
    const path = parent === "" ? row.child : `${parent}/${row.child}`;
    const entry = stats.get(path) ?? { previews: [], count: row.total };
    entry.previews.push(row.key);
    stats.set(path, entry);
  }
  return stats;
}

/**
 * Rows the user sees, and bytes the account is actually billed for. The two
 * differ whenever one deduplicated object backs several rows, so the totals
 * are counted over distinct keys rather than over rows.
 */
async function libraryStats(db: Db) {
  const objects = db
    .select({ size: sql<number>`min(${files.size})`.as("size") })
    .from(files)
    .groupBy(files.key)
    .as("objects");

  const [logical, physical] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(files).get(),
    db
      .select({ bytes: sql<number>`coalesce(sum(${objects.size}), 0)` })
      .from(objects)
      .get(),
  ]);

  return { count: logical?.count ?? 0, totalSize: physical?.bytes ?? 0 };
}

export const fileRoutes = new Hono<AppEnv>()

  /** Contents of one folder plus global storage stats. */
  .get(
    "/api/list",
    requireAuth,
    zValidator("query", z.object({ folder: folderSchema.default("") })),
    async (c) => {
      const { folder } = c.req.valid("query");
      const db = createDb(c.env.DB);

      const [rows, allFolders, stats, childStats] = await Promise.all([
        db
          .select()
          .from(files)
          .where(eq(files.folder, folder))
          .orderBy(desc(files.createdAt), desc(files.id)),
        // Folder count stays small in a personal library; filtering the
        // direct children in JS avoids LIKE-escape gymnastics in SQL.
        db.select().from(folders).orderBy(folders.path),
        libraryStats(db),
        childFolderStats(db, folder),
      ]);

      const children = allFolders
        .filter((f) => isDirectChild(f.path, folder))
        .map((f) => ({
          path: f.path,
          name: f.path.split("/").pop() ?? f.path,
          ...(childStats.get(f.path) ?? { previews: [], count: 0 }),
        }));

      return c.json({
        folder,
        folders: children,
        files: rows.map((r) => ({
          // `key` addresses the bytes and may repeat; `id` addresses the file.
          id: r.id,
          key: r.key,
          folder: r.folder,
          name: r.name,
          size: r.size,
          mime: r.mime,
          uploaded: r.createdAt,
        })),
        count: stats.count,
        // Stored bytes, not the sum of the rows: two folders holding the same
        // image cost storage once, and the header says "used".
        totalSize: stats.totalSize,
      });
    }
  )

  /** Upload: raw bytes as body; name and target folder via query. */
  .put(
    "/api/upload",
    requireAuth,
    zValidator(
      "query",
      z.object({
        name: z.string().min(1),
        folder: folderSchema.default(""),
      })
    ),
    async (c) => {
      const { name: rawName, folder } = c.req.valid("query");
      const db = createDb(c.env.DB);

      // Reject on the declared length first so an oversized body is never
      // buffered; the real length is checked again once it has been read.
      if (Number(c.req.header("Content-Length")) > MAX_UPLOAD_BYTES) {
        return c.json({ error: "payload too large" }, 413);
      }

      const body = await c.req.arrayBuffer();
      if (body.byteLength === 0) return c.json({ error: "empty body" }, 400);
      if (body.byteLength > MAX_UPLOAD_BYTES) {
        return c.json({ error: "payload too large" }, 413);
      }

      // The signature decides, not the request header: `Content-Type` is
      // whatever the client felt like sending, and objects from this bucket
      // are served off the same origin as the dashboard.
      const format = detectImage(body);
      if (!format) return c.json({ error: "unsupported media type" }, 415);

      const displayName = withImageExtension(
        sanitizeFileName(rawName),
        format
      );
      const hash = await sha256Hex(body);
      const key = contentKey(hash, format);

      // Same bytes already sitting in this folder: nothing to store, nothing
      // to add. Re-dropping a file the user already has is a no-op, not a copy.
      const duplicate = await db
        .select({ id: files.id, name: files.name })
        .from(files)
        .where(and(eq(files.key, key), eq(files.folder, folder)))
        .get();
      if (duplicate) {
        return c.json({
          id: duplicate.id,
          key,
          name: duplicate.name,
          url: `/f/${key}`,
          deduplicated: true,
        });
      }

      await ensureFolders(db, folder);

      // The object may already exist from an upload into another folder.
      // Skipping the PUT saves both the storage and the Class A operation —
      // but only after R2 confirms it, because a row pointing at an object
      // that is no longer there would produce a permanently broken image.
      const indexed = await db
        .select({ id: files.id })
        .from(files)
        .where(eq(files.key, key))
        .get();
      if (!indexed || !(await c.env.BUCKET.head(key))) {
        // R2 first, then the D1 index; a failure in between leaves an
        // unindexed object that repair picks up later — which is exactly why
        // the name and folder ride along as customMetadata.
        await c.env.BUCKET.put(key, body, {
          httpMetadata: { contentType: format.mime },
          customMetadata: { name: displayName, folder },
        });
      }

      try {
        const { id, name } = await insertFileRow(
          db,
          {
            key,
            folder,
            size: body.byteLength,
            mime: format.mime,
            hash,
            createdAt: Date.now(),
          },
          displayName
        );
        return c.json({ id, key, name, url: `/f/${key}` });
      } catch (error) {
        if (!isKeyTaken(error)) throw error;
        // A parallel upload of the same image into the same folder got there
        // between the duplicate check above and this insert. The unique index
        // is what makes that one file rather than two; report the winner.
        const winner = await db
          .select({ id: files.id, name: files.name })
          .from(files)
          .where(and(eq(files.key, key), eq(files.folder, folder)))
          .get();
        if (!winner) throw error;
        return c.json({ ...winner, key, url: `/f/${key}`, deduplicated: true });
      }
    }
  )

  /** Move and/or rename. Pure metadata: the object is never touched. */
  .patch(
    "/api/file",
    requireAuth,
    zValidator(
      "json",
      z
        .object({
          id: z.number().int().positive(),
          folder: folderSchema.optional(),
          name: z.string().min(1).optional(),
        })
        .refine(
          (v) => v.folder !== undefined || v.name !== undefined,
          "nothing to change"
        )
    ),
    async (c) => {
      const { id, folder, name } = c.req.valid("json");
      const db = createDb(c.env.DB);

      const row = await db
        .select({ folder: files.folder, name: files.name })
        .from(files)
        .where(eq(files.id, id))
        .get();
      if (!row) return c.json({ error: "not found" }, 404);

      const targetFolder = folder ?? row.folder;
      const desiredName = name ? sanitizeFileName(name) : row.name;
      if (targetFolder === row.folder && desiredName === row.name) {
        return c.json({ id, folder: row.folder, name: row.name });
      }

      await ensureFolders(db, targetFolder);
      // A name already used in the destination gets the usual `-2` suffix
      // rather than failing the move outright.
      const finalName = await resolveUniqueName(db, targetFolder, desiredName);

      await db
        .update(files)
        .set({ folder: targetFolder, name: finalName })
        .where(eq(files.id, id));

      return c.json({ id, folder: targetFolder, name: finalName });
    }
  )

  /** Delete a single file. */
  .delete(
    "/api/file",
    requireAuth,
    zValidator("query", z.object({ id: z.coerce.number().int().positive() })),
    async (c) => {
      const { id } = c.req.valid("query");
      const db = createDb(c.env.DB);

      // Cascades to shares via the foreign key; drops the object only when
      // no other folder still references the same content.
      const deleted = await deleteFileRows(db, c.env.BUCKET, eq(files.id, id));
      if (deleted === 0) return c.json({ error: "not found" }, 404);
      return c.json({ ok: true });
    }
  )

  /**
   * Public direct link. Only PicNest's own content-addressed keys resolve
   * here, so anything else that ends up in the bucket — an object copied in
   * by hand, a backup written later — is not reachable by guessing its name.
   */
  .get("/f/*", (c) => {
    let key: string;
    try {
      key = decodeURIComponent(c.req.path.slice("/f/".length));
    } catch {
      // Not `c.notFound()`: that falls through to the SPA shell, and a broken
      // image link should answer 404, not 200 with a page in it.
      return c.text("Not found", 404);
    }
    if (!CONTENT_KEY_RE.test(key)) return c.text("Not found", 404);
    return serveObject(c.env.BUCKET, key, { immutable: true });
  });
