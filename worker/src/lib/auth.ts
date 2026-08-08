import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { jwt } from "hono/jwt";
import { JWT_ISSUER } from "../config";
import type { AppEnv } from "../types";

/**
 * Auth middleware: verifies `Authorization: Bearer <jwt>`.
 *
 * Signed with `JWT_SECRET`, which is a random key and nothing else — the
 * admin password is only ever compared against, never used as an HMAC key.
 * Rotating `JWT_SECRET` is how you revoke every session; changing the
 * password no longer does that on its own.
 */
export const requireAuth: MiddlewareHandler<AppEnv> = (c, next) =>
  jwt({ secret: c.env.JWT_SECRET, alg: "HS256" })(c, async () => {
    if (c.get("jwtPayload")?.iss !== JWT_ISSUER) {
      throw new HTTPException(401, { message: "invalid token" });
    }
    await next();
  });
