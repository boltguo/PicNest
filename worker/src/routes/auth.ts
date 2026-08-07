import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import { timingSafeEqual } from "hono/utils/buffer";
import { z } from "zod";
import { TOKEN_TTL_SECONDS } from "../config";
import type { AppEnv } from "../types";

export const authRoutes = new Hono<AppEnv>().post(
  "/api/login",
  zValidator("json", z.object({ password: z.string().min(1) })),
  async (c) => {
    // Throttle before comparing: one password guards everything here and it is
    // also the JWT signing key, so guesses must cost more than a round trip.
    // `CF-Connecting-IP` is set by the edge and cannot be spoofed; it is absent
    // in local dev, where a single shared bucket is fine.
    const { success } = await c.env.LOGIN_LIMITER.limit({
      key: c.req.header("CF-Connecting-IP") ?? "local",
    });
    if (!success) return c.json({ error: "too many attempts" }, 429);

    const { password } = c.req.valid("json");
    if (
      !c.env.ADMIN_PASSWORD ||
      !(await timingSafeEqual(password, c.env.ADMIN_PASSWORD))
    ) {
      return c.json({ error: "invalid password" }, 401);
    }
    const token = await sign(
      { exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS },
      c.env.ADMIN_PASSWORD
    );
    return c.json({ token });
  }
);
