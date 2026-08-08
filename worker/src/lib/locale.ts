export type Locale = "en" | "zh";

/**
 * Cookie the SPA mirrors its language choice into. localStorage is invisible
 * to the Worker, so without this mirror a server-rendered share page could
 * only guess from Accept-Language and would contradict the app's own UI.
 */
export const LOCALE_COOKIE = "picnest-lang";

/** i18next stores region tags too ("zh-CN"), so match on the prefix. */
function fromTag(tag: string | undefined): Locale | undefined {
  const lower = tag?.toLowerCase();
  if (!lower) return undefined;
  if (lower.startsWith("zh")) return "zh";
  if (lower.startsWith("en")) return "en";
  return undefined;
}

/**
 * Pick a UI locale for server-rendered pages. The owner's explicit choice in
 * the app wins; a visitor who only ever followed a share link has no cookie,
 * so their browser's Accept-Language decides for them.
 */
export function pickLocale(
  cookie: string | undefined,
  acceptLanguage: string | undefined
): Locale {
  return (
    fromTag(cookie) ??
    (acceptLanguage?.toLowerCase().includes("zh") ? "zh" : "en")
  );
}
