import { RESERVED_PREFIX } from "../config";

/**
 * `inline` keeps the browser previewing the image; the filename only takes
 * effect when the user actually saves it. Object keys are content hashes,
 * so without this a download would land as `9c4a7e21….jpg`.
 */
function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Object bytes are user-supplied but served from the app's own origin, so an
 * SVG (or anything mislabelled `text/html`) could otherwise run scripts with
 * access to the dashboard session. `sandbox` puts the response in an opaque
 * origin with scripting off; `nosniff` stops the browser from second-guessing
 * the stored content type. Images still render.
 */
const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "sandbox",
  "X-Content-Type-Options": "nosniff",
};

interface ServeOptions {
  /** Long-lived caching. Safe only because keys are content-addressed. */
  immutable?: boolean;
  /**
   * Display name for the download. Defaults to the object's own
   * customMetadata, which avoids a D1 read on the hot image path.
   */
  fileName?: string;
}

/**
 * Read an object from R2 and return it as an HTTP response.
 * Public direct links get a long immutable cache (a content-addressed key
 * can never serve different bytes); share links carry expiry/password
 * semantics, so no cache.
 */
export async function serveObject(
  bucket: R2Bucket,
  key: string,
  { immutable = false, fileName }: ServeOptions = {}
): Promise<Response> {
  if (!key || key.startsWith(RESERVED_PREFIX)) {
    return new Response("Not found", { status: 404 });
  }
  const object = await bucket.get(key);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers(SECURITY_HEADERS);
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set(
    "Cache-Control",
    immutable ? "public, max-age=31536000, immutable" : "private, no-store"
  );

  const name = fileName ?? object.customMetadata?.name;
  if (name) headers.set("Content-Disposition", contentDisposition(name));

  return new Response(object.body, { headers });
}
