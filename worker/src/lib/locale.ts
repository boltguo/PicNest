export type Locale = "en" | "zh";

/** Pick a UI locale for server-rendered pages from the Accept-Language header. */
export function pickLocale(acceptLanguage: string | undefined): Locale {
  return acceptLanguage?.toLowerCase().includes("zh") ? "zh" : "en";
}
