import { zValidator } from "@hono/zod-validator";
import { desc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { timingSafeEqual } from "hono/utils/buffer";
import { nanoid } from "nanoid";
import { z } from "zod";
import { SHARE_TOKEN_LENGTH } from "../config";
import { createDb, files, shares } from "../db";
import { requireAuth } from "../lib/auth";
import { sha256Hex } from "../lib/hash";
import { LOCALE_COOKIE, pickLocale } from "../lib/locale";
import { serveObject } from "../lib/r2";
import { errorPage, passwordPage } from "../templates/pages";
import type { AppEnv } from "../types";

export const shareRoutes = new Hono<AppEnv>()

  /** Create a share link with optional expiry (hours) and password. */
  .post(
    "/api/share",
    requireAuth,
    zValidator(
      "json",
      z.object({
        id: z.number().int().positive(),
        hours: z.number().positive().nullish(),
        password: z.string().min(1).nullish(),
      })
    ),
    async (c) => {
      const { id, hours, password } = c.req.valid("json");
      const db = createDb(c.env.DB);

      const file = await db
        .select({ id: files.id })
        .from(files)
        .where(eq(files.id, id))
        .get();
      if (!file) return c.json({ error: "file not found" }, 404);

      const token = nanoid(SHARE_TOKEN_LENGTH);
      const expiresAt = hours ? Date.now() + hours * 3600_000 : null;
      await db.insert(shares).values({
        token,
        fileId: file.id,
        expiresAt,
        passwordHash: password ? await sha256Hex(password) : null,
        createdAt: Date.now(),
      });
      return c.json({ url: `/s/${token}`, exp: expiresAt });
    }
  )

  /** List all shares with their target files (management UI). */
  .get("/api/shares", requireAuth, async (c) => {
    const db = createDb(c.env.DB);
    const rows = await db
      .select({
        token: shares.token,
        name: files.name,
        expiresAt: shares.expiresAt,
        hasPassword: sql<number>`${shares.passwordHash} IS NOT NULL`,
        visits: shares.visits,
        createdAt: shares.createdAt,
      })
      .from(shares)
      .innerJoin(files, eq(shares.fileId, files.id))
      .orderBy(desc(shares.createdAt));
    return c.json({
      shares: rows.map((r) => ({ ...r, hasPassword: Boolean(r.hasPassword) })),
    });
  })

  /** Revoke a share link. */
  .delete(
    "/api/share",
    requireAuth,
    zValidator("query", z.object({ token: z.string().min(1) })),
    async (c) => {
      const db = createDb(c.env.DB);
      await db.delete(shares).where(eq(shares.token, c.req.valid("query").token));
      return c.json({ ok: true });
    }
  )

  /** Visit a share: expiry and password checks (password as SHA-256 hex in ?p=). */
  .get("/s/:token", async (c) => {
    const token = c.req.param("token");
    const locale = pickLocale(
      getCookie(c, LOCALE_COOKIE),
      c.req.header("Accept-Language")
    );
    const db = createDb(c.env.DB);

    const row = await db
      .select({
        id: shares.id,
        passwordHash: shares.passwordHash,
        expiresAt: shares.expiresAt,
        key: files.key,
        name: files.name,
      })
      .from(shares)
      .innerJoin(files, eq(shares.fileId, files.id))
      .where(eq(shares.token, token))
      .get();

    if (!row) return c.html(errorPage(locale, "notFound"), 404);

    if (row.expiresAt !== null && Date.now() > row.expiresAt) {
      await db.delete(shares).where(eq(shares.id, row.id));
      return c.html(errorPage(locale, "expired"), 410);
    }

    if (row.passwordHash !== null) {
      const provided = c.req.query("p");
      if (
        provided === undefined ||
        !(await timingSafeEqual(provided, row.passwordHash))
      ) {
        return c.html(
          passwordPage(locale, provided !== undefined),
          provided !== undefined ? 403 : 401
        );
      }
    }

    c.executionCtx.waitUntil(
      db
        .update(shares)
        .set({ visits: sql`${shares.visits} + 1` })
        .where(eq(shares.id, row.id))
    );
    // The row is already loaded here, so prefer D1's name over the object's
    // customMetadata copy — a rename since upload is reflected immediately.
    return serveObject(c.env.BUCKET, row.key, { fileName: row.name });
  });
