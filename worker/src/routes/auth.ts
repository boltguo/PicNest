import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import { timingSafeEqual } from "hono/utils/buffer";
import { z } from "zod";
import { JWT_ISSUER, TOKEN_TTL_SECONDS } from "../config";
import type { AppEnv } from "../types";

export const authRoutes = new Hono<AppEnv>().post(
  "/api/login",
  zValidator("json", z.object({ password: z.string().min(1) })),
  async (c) => {
    // Throttle before comparing: one password guards everything here, so
    // guesses must cost more than a round trip. `CF-Connecting-IP` is set by
    // the edge and cannot be spoofed; it is absent in local dev, where a
    // single shared bucket is fine.
    const { success } = await c.env.LOGIN_LIMITER.limit({
      key: c.req.header("CF-Connecting-IP") ?? "local",
    });
    if (!success) return c.json({ error: "too many attempts" }, 429);

    // Signing with an empty secret would mint tokens anyone could forge, so a
    // half-configured deployment refuses to log in rather than pretending to.
    if (!c.env.ADMIN_PASSWORD || !c.env.JWT_SECRET) {
      return c.json({ error: "server not configured" }, 500);
    }

    const { password } = c.req.valid("json");
    if (!(await timingSafeEqual(password, c.env.ADMIN_PASSWORD))) {
      return c.json({ error: "invalid password" }, 401);
    }

    const now = Math.floor(Date.now() / 1000);
    const token = await sign(
      { sub: "admin", iss: JWT_ISSUER, iat: now, exp: now + TOKEN_TTL_SECONDS },
      c.env.JWT_SECRET
    );
    return c.json({ token });
  }
);
