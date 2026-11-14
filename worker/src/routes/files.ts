import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, gt, lt, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { CONTENT_KEY_RE, MAX_UPLOAD_BYTES } from "../config";
import { createDb, files, folders, tombstones, type Db } from "../db";
import { requireAuth } from "../lib/auth";
import { insertFileRow, isKeyTaken } from "../lib/files";
import { sha256Hex } from "../lib/hash";
import { detectImage, formatForKey, withImageExtension } from "../lib/image";
import {
  contentKey,
  descendantOf,
  ensureFolders,
  folderSchema,
  relativeTo,
  resolveUniqueName,
  sanitizeFileName,
} from "../lib/paths";
import {
  assertFolderWritable,
  deleteRows,
  thumbnailKey,
} from "../lib/maintenance";
import { decodeCursor, encodeCursor, SORT_KEYS } from "../lib/pagination";
import { serveObject } from "../lib/r2";
import type { AppEnv } from "../types";

/** How many recent images peek out of a folder card. */
const FOLDER_PREVIEW_LIMIT = 5;

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
  parent: string,
): Promise<Map<string, FolderStats>> {
  // Everything strictly under `parent`; each such row belongs to exactly one
  // direct child, and their union is every file the children hold.
  const scope =
    parent === ""
      ? sql`${files.folder} <> ''`
      : descendantOf(files.folder, parent);
  const relative = relativeTo(files.folder, parent);

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

export const fileRoutes = new Hono<AppEnv>()

  .get(
    "/api/list",
    requireAuth,
    zValidator(
      "query",
      z.object({
        folder: folderSchema.default(""),
        sort: z.enum(SORT_KEYS).default("newest"),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        cursor: z.string().max(4096).optional(),
      }),
    ),
    async (c) => {
      const { folder, sort, limit, cursor } = c.req.valid("query");
      const db = createDb(c.env.DB);
      const decoded = cursor ? decodeCursor(cursor, folder, sort) : null;
      if (cursor && !decoded) return c.json({ error: "invalid cursor" }, 400);
      const column = sort.startsWith("name")
        ? files.name
        : ["largest", "smallest"].includes(sort)
          ? files.size
          : files.createdAt;
      const descending = ["newest", "largest", "nameDesc"].includes(sort);
      const compare = descending ? lt : gt;
      const order = descending ? desc : asc;
      const after = decoded
        ? or(
            compare(column, decoded.value),
            and(eq(column, decoded.value), compare(files.id, decoded.id)),
          )
        : undefined;
      const [rows, childFolders, childStats] = await Promise.all([
        db
          .select()
          .from(files)
          .where(and(eq(files.folder, folder), after))
          .orderBy(order(column), order(files.id))
          .limit(limit + 1),
        cursor
          ? Promise.resolve([])
          : db
              .select()
              .from(folders)
              .where(
                folder === ""
                  ? sql`instr(${folders.path}, '/') = 0`
                  : and(
                      descendantOf(folders.path, folder),
                      sql`instr(${relativeTo(folders.path, folder)}, '/') = 0`,
                    ),
              )
              .orderBy(folders.path),
        cursor
          ? Promise.resolve(new Map<string, FolderStats>())
          : childFolderStats(db, folder),
      ]);
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return c.json({
        folder,
        folders: childFolders.map((f) => ({
          path: f.path,
          name: f.path.split("/").pop()!,
          ...(childStats.get(f.path) ?? { previews: [], count: 0 }),
        })),
        files: page.map((r) => ({
          id: r.id,
          key: r.key,
          folder: r.folder,
          name: r.name,
          size: r.size,
          mime: r.mime,
          uploaded: r.createdAt,
          width: r.width,
          height: r.height,
          thumbnail: Boolean(r.thumbnailKey),
          missing: Boolean(r.missing),
        })),
        nextCursor:
          rows.length > limit && last
            ? encodeCursor({
                folder,
                sort,
                id: last.id,
                value: sort.startsWith("name")
                  ? last.name
                  : ["largest", "smallest"].includes(sort)
                    ? last.size
                    : last.createdAt,
              })
            : null,
      });
    },
  )

  /** Upload: raw bytes as body; name and target folder via query. */
  .put(
    "/api/upload",
    requireAuth,
    // `Content-Length` is optional — a chunked request has none, and the
    // handler buffers the whole body to hash it. This counts the stream and
    // stops at the limit, so a 100 MB request (the platform's own ceiling)
    // cannot be read into a 128 MB isolate before being rejected.
    bodyLimit({
      maxSize: MAX_UPLOAD_BYTES,
      onError: (c) => c.json({ error: "payload too large" }, 413),
    }),
    zValidator(
      "query",
      z.object({
        name: z.string().min(1),
        folder: folderSchema.default(""),
      }),
    ),
    async (c) => {
      const { name: rawName, folder } = c.req.valid("query");
      const db = createDb(c.env.DB);
      await assertFolderWritable(c.env, folder);

      const body = await c.req.arrayBuffer();
      if (body.byteLength === 0) return c.json({ error: "empty body" }, 400);

      // The signature decides, not the request header: `Content-Type` is
      // whatever the client felt like sending, and objects from this bucket
      // are served off the same origin as the dashboard.
      const format = detectImage(body);
      if (!format) return c.json({ error: "unsupported media type" }, 415);

      const displayName = withImageExtension(sanitizeFileName(rawName), format);
      const hash = await sha256Hex(body);
      const key = contentKey(hash, format);

      /**
       * Write the bytes unless R2 already has them. Skipping the PUT saves the
       * storage and the Class A operation, but the check has to be R2's own
       * answer rather than "some row points at this key" — a row outliving its
       * object is exactly the state re-uploading is supposed to repair.
       *
       * R2 first, then the D1 index; a failure in between leaves an unindexed
       * object that repair picks up later, which is why the name and folder
       * ride along as customMetadata.
       */
      const storeUnlessPresent = async (name: string) => {
        if (await c.env.BUCKET.head(key)) return;
        await c.env.BUCKET.put(key, body, {
          httpMetadata: { contentType: format.mime },
          customMetadata: { name, folder },
        });
      };
      const finishUpload = () =>
        db.batch([
          db.delete(tombstones).where(eq(tombstones.key, key)),
          db.update(files).set({ missing: 0 }).where(eq(files.key, key)),
        ]);

      // Same bytes already sitting in this folder: nothing to add. Re-dropping
      // a file the user already has is a no-op, not a copy — but it is also
      // how someone fixes an image whose object went missing, so the bytes are
      // still restored before reporting the existing row back.
      const duplicate = await db
        .select({ id: files.id, name: files.name })
        .from(files)
        .where(and(eq(files.key, key), eq(files.folder, folder)))
        .get();
      if (duplicate) {
        await storeUnlessPresent(duplicate.name);
        await finishUpload();
        return c.json({
          id: duplicate.id,
          key,
          name: duplicate.name,
          url: `/f/${key}`,
          deduplicated: true,
        });
      }

      await ensureFolders(db, folder);
      await storeUnlessPresent(displayName);
      const existingPreview = await db
        .select({
          width: files.width,
          height: files.height,
          thumbnailKey: files.thumbnailKey,
        })
        .from(files)
        .where(and(eq(files.key, key), sql`${files.thumbnailKey} IS NOT NULL`))
        .get();

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
            ...existingPreview,
          },
          displayName,
        );
        // Clear the deletion intent only after both bytes and a reference exist.
        await finishUpload();
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
        await finishUpload();
        return c.json({ ...winner, key, url: `/f/${key}`, deduplicated: true });
      }
    },
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
          "nothing to change",
        ),
    ),
    async (c) => {
      const { id, folder, name } = c.req.valid("json");
      const db = createDb(c.env.DB);

      const row = await db
        .select({ folder: files.folder, name: files.name, key: files.key })
        .from(files)
        .where(eq(files.id, id))
        .get();
      if (!row) return c.json({ error: "not found" }, 404);

      const targetFolder = folder ?? row.folder;
      await assertFolderWritable(c.env, row.folder);
      await assertFolderWritable(c.env, targetFolder);
      // Upload guarantees the display name matches the format the sniffer
      // found; a rename must not be the way back out of that. Renaming a PNG
      // to `notes.html` is not dangerous — R2 supplies the content type and
      // `/f/` serves it sandboxed and `nosniff` — but it would put a wrong
      // extension on the file the browser writes to disk.
      const format = formatForKey(row.key);
      const cleaned = name ? sanitizeFileName(name) : row.name;
      const desiredName =
        name && format ? withImageExtension(cleaned, format) : cleaned;

      if (targetFolder === row.folder && desiredName === row.name) {
        return c.json({ id, folder: row.folder, name: row.name });
      }

      // The destination already holds this exact image. Merging or replacing
      // would be a guess — this file has its own name and possibly its own
      // share links — so the conflict goes back to the caller.
      if (targetFolder !== row.folder) {
        const clash = await db
          .select({ id: files.id })
          .from(files)
          .where(and(eq(files.folder, targetFolder), eq(files.key, row.key)))
          .get();
        if (clash) return c.json({ error: "already in target folder" }, 409);
      }

      await ensureFolders(db, targetFolder);
      // A name already used in the destination gets the usual `-2` suffix
      // rather than failing the move outright.
      const finalName = await resolveUniqueName(db, targetFolder, desiredName);

      try {
        await db
          .update(files)
          .set({ folder: targetFolder, name: finalName })
          .where(eq(files.id, id));
      } catch (error) {
        // A parallel move landed the same image in the destination between
        // the check above and this update. Same answer, just later.
        if (!isKeyTaken(error)) throw error;
        return c.json({ error: "already in target folder" }, 409);
      }

      return c.json({ id, folder: targetFolder, name: finalName });
    },
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
      const rows = await db
        .select({ id: files.id, key: files.key, folder: files.folder })
        .from(files)
        .where(eq(files.id, id));
      if (!rows.length) return c.json({ error: "not found" }, 404);
      await assertFolderWritable(c.env, rows[0].folder);
      await deleteRows(c.env, rows);
      return c.json({ ok: true });
    },
  )

  .put(
    "/api/thumbnail",
    requireAuth,
    bodyLimit({ maxSize: 512 * 1024 }),
    zValidator(
      "query",
      z.object({
        id: z.coerce.number().int().positive(),
        width: z.coerce.number().int().positive().max(100000),
        height: z.coerce.number().int().positive().max(100000),
      }),
    ),
    async (c) => {
      const { id, width, height } = c.req.valid("query");
      const db = createDb(c.env.DB);
      const file = await db.select().from(files).where(eq(files.id, id)).get();
      if (!file) return c.json({ error: "not found" }, 404);
      await assertFolderWritable(c.env, file.folder);
      const bytes = await c.req.arrayBuffer();
      const format = detectImage(bytes);
      if (format?.mime !== "image/webp")
        return c.json({ error: "thumbnail must be WebP" }, 415);
      const key = thumbnailKey(file.key);
      await c.env.BUCKET.put(key, bytes, {
        httpMetadata: { contentType: "image/webp" },
      });
      await db
        .update(files)
        .set({ width, height, thumbnailKey: key })
        .where(eq(files.key, file.key));
      return c.json({ ok: true });
    },
  )
  .get(
    "/api/thumbnails/pending",
    requireAuth,
    zValidator(
      "query",
      z.object({ after: z.coerce.number().int().nonnegative().default(0) }),
    ),
    async (c) => {
      const rows = await createDb(c.env.DB)
        .select({ id: files.id, key: files.key, name: files.name })
        .from(files)
        .where(
          and(
            gt(files.id, c.req.valid("query").after),
            sql`${files.thumbnailKey} IS NULL`,
            eq(files.missing, 0),
          ),
        )
        .orderBy(files.id)
        .limit(20);
      return c.json({
        files: rows,
        next: rows.length === 20 ? rows[19].id : null,
      });
    },
  )
  .get("/t/:key", async (c) => {
    const key = c.req.param("key");
    if (!CONTENT_KEY_RE.test(key)) return c.text("Not found", 404);
    const object = await c.env.BUCKET.get(thumbnailKey(key));
    if (!object) {
      c.header("Cache-Control", "no-store");
      return c.redirect(`/f/${key}`, 302);
    }
    return new Response(object.body, {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
      },
    });
  })

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
