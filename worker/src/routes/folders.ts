import { zValidator } from "@hono/zod-validator";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { createDb, files, folders, jobs } from "../db";
import { requireAuth } from "../lib/auth";
import { assertFolderWritable, subtree } from "../lib/maintenance";
import { ensureFolders, folderPathSchema } from "../lib/paths";
import type { AppEnv } from "../types";

export const folderRoutes = new Hono<AppEnv>()
  .get("/api/folders", requireAuth, async (c) => {
    const rows = await createDb(c.env.DB)
      .select({ path: folders.path })
      .from(folders)
      .orderBy(folders.path);
    return c.json({ folders: rows.map((r) => r.path) });
  })
  .post(
    "/api/folder",
    requireAuth,
    zValidator("json", z.object({ path: folderPathSchema })),
    async (c) => {
      const { path } = c.req.valid("json");
      await assertFolderWritable(c.env, path);
      await ensureFolders(createDb(c.env.DB), path);
      return c.json({ path });
    },
  )
  .delete(
    "/api/folder",
    requireAuth,
    zValidator("query", z.object({ path: folderPathSchema })),
    async (c) => {
      const { path } = c.req.valid("query");
      const db = createDb(c.env.DB);
      const active = await db
        .select()
        .from(jobs)
        .where(
          and(eq(jobs.kind, "delete-folder"), sql`${jobs.status} <> 'done'`),
        );
      const existing = active.find(
        (j) => path === j.path || path.startsWith(`${j.path}/`),
      );
      if (existing) return c.json(existing, 202);
      if (active.some((j) => j.path.startsWith(`${path}/`)))
        return c.json({ error: "child folder deletion in progress" }, 409);
      const folder = await db
        .select()
        .from(folders)
        .where(eq(folders.path, path))
        .get();
      if (!folder) return c.json({ error: "not found" }, 404);
      const total = await db
        .select({ count: sql<number>`count(*)` })
        .from(files)
        .where(subtree(path))
        .get();
      const row = await db
        .insert(jobs)
        .values({
          id: crypto.randomUUID(),
          kind: "delete-folder",
          path,
          total: total?.count ?? 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        .returning()
        .get();
      return c.json(row, 202);
    },
  );
