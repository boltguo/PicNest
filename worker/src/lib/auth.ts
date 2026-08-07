import type { MiddlewareHandler } from "hono";
import { jwt } from "hono/jwt";
import type { AppEnv } from "../types";

/**
 * Auth middleware: verifies `Authorization: Bearer <jwt>`.
 * The JWT secret is ADMIN_PASSWORD itself — in a single-user setup,
 * changing the password revokes every session, which is what you want.
 */
export const requireAuth: MiddlewareHandler<AppEnv> = (c, next) =>
  jwt({ secret: c.env.ADMIN_PASSWORD, alg: "HS256" })(c, next);
