import i18n from "../i18n";

const locale = () => (i18n.language.startsWith("zh") ? "zh-CN" : "en-US");

export const formatDate = (epochMs: number) =>
  new Intl.DateTimeFormat(locale(), { dateStyle: "medium" }).format(new Date(epochMs));

/** Used where the time of day matters, e.g. short-lived share expiry. */
export const formatDateTime = (epochMs: number) =>
  new Intl.DateTimeFormat(locale(), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(epochMs));
