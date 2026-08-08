import { zValidator } from "@hono/zod-validator";
import { eq, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { createDb, files, folders } from "../db";
import { requireAuth } from "../lib/auth";
import { deleteFileRows } from "../lib/files";
import { descendantOf, ensureFolders, folderPathSchema } from "../lib/paths";
import type { AppEnv } from "../types";

export const folderRoutes = new Hono<AppEnv>()

  /** Every folder path, for pickers that need the whole tree at once. */
  .get("/api/folders", requireAuth, async (c) => {
    const rows = await createDb(c.env.DB)
      .select({ path: folders.path })
      .from(folders)
      .orderBy(folders.path);
    return c.json({ folders: rows.map((r) => r.path) });
  })

  /** Create a folder (and any missing ancestors). Idempotent. */
  .post(
    "/api/folder",
    requireAuth,
    zValidator("json", z.object({ path: folderPathSchema })),
    async (c) => {
      const { path } = c.req.valid("json");
      await ensureFolders(createDb(c.env.DB), path);
      return c.json({ path });
    }
  )

  /** Delete a folder recursively: every file underneath, in R2 and D1. */
  .delete(
    "/api/folder",
    requireAuth,
    zValidator("query", z.object({ path: folderPathSchema })),
    async (c) => {
      const { path } = c.req.valid("query");
      const db = createDb(c.env.DB);

      const deletedFiles = await deleteFileRows(
        db,
        c.env.BUCKET,
        or(eq(files.folder, path), descendantOf(files.folder, path))
      );
      await db
        .delete(folders)
        .where(
          or(eq(folders.path, path), descendantOf(folders.path, path))
        );

      return c.json({ ok: true, deletedFiles });
    }
  );
