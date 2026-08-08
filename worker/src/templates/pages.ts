import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { Locale } from "../lib/locale";

/** Strings for server-rendered share pages, keyed by locale. */
const STRINGS = {
  en: {
    notFoundTitle: "Link not found",
    notFoundBody: "This share link is invalid or has been deleted.",
    expiredTitle: "Link expired",
    expiredBody: "This share link has expired. Ask the owner for a new one.",
    throttledTitle: "Too many attempts",
    throttledBody: "Wait a minute before trying this link again.",
    passwordTitle: "Password required",
    passwordBody: "This share is protected by a password.",
    passwordPlaceholder: "Enter password",
    passwordWrong: "Wrong password, try again",
    passwordSubmit: "View",
  },
  zh: {
    notFoundTitle: "链接不存在",
    notFoundBody: "这个分享链接无效或已被删除。",
    expiredTitle: "链接已过期",
    expiredBody: "这个分享链接已经过期，可以向分享者要一条新的。",
    throttledTitle: "尝试次数过多",
    throttledBody: "请等待一分钟后再打开这个链接。",
    passwordTitle: "需要访问密码",
    passwordBody: "这是一个受密码保护的分享。",
    passwordPlaceholder: "输入密码",
    passwordWrong: "密码错误，请重试",
    passwordSubmit: "查看",
  },
} satisfies Record<Locale, Record<string, string>>;

/**
 * Lucide glyph bodies, inlined so these pages stay a single request with no
 * font or script dependency. Stroke attributes live on the shared <svg>.
 */
const ICONS = {
  notFound: `<path d="M9 17H7A5 5 0 0 1 7 7"/><path d="M15 7h2a5 5 0 0 1 4 8"/><line x1="8" x2="12" y1="12" y2="12"/><line x1="2" x2="22" y1="2" y2="22"/>`,
  expired: `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`,
  throttled: `<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>`,
  password: `<circle cx="12" cy="16" r="1"/><rect x="3" y="10" width="18" height="12" rx="2"/><path d="M7 10V7a5 5 0 0 1 10 0v3"/>`,
} as const;

/**
 * Shared shell for the server-rendered share pages. Deliberately card-less:
 * these are "nothing here" moments, and a framed panel makes the absence look
 * like a thing on the page instead of the page having nothing to show.
 */
const shell = (
  locale: Locale,
  title: string,
  icon: keyof typeof ICONS,
  body: HtmlEscapedString | Promise<HtmlEscapedString>
) => html`<!doctype html>
<html lang="${locale === "zh" ? "zh-CN" : "en"}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <link rel="icon" type="image/svg+xml" href="/logo.svg" />
    <title>${title} · PicNest</title>
    <style>
      * { box-sizing: border-box; }
      body {
        min-height: 100svh; margin: 0; display: grid; place-items: center;
        padding: 24px; background: #fafafa; color: #262626;
        font-family: "SF Compact", -apple-system, BlinkMacSystemFont, "Segoe UI",
          Roboto, Helvetica, Arial, sans-serif;
      }
      .state { width: min(320px, 100%); text-align: center; }
      .icon {
        display: grid; place-items: center; width: 48px; height: 48px;
        margin: 0 auto 16px; border-radius: 16px;
        background: rgb(0 0 0 / 0.04); color: #737373;
      }
      .icon svg { width: 20px; height: 20px; }
      h1 { margin: 0 0 6px; font-size: 16px; font-weight: 600; }
      p { margin: 0; color: #737373; font-size: 13px; line-height: 20px; }
      form { margin-top: 20px; }
      input {
        width: 100%; padding: 10px 14px; font-size: 14px; background: white;
        border: 1px solid #e5e5e5; border-radius: 12px; outline: none;
      }
      input:focus { border-color: #a3a3a3; }
      button {
        width: 100%; margin-top: 12px; padding: 10px; font-size: 14px; font-weight: 500;
        color: white; background: #262626; border: none; border-radius: 12px; cursor: pointer;
      }
      .err { margin-top: 10px; color: #dc2626; font-size: 12px; }
    </style>
  </head>
  <body>
    <main class="state">
      <div class="icon">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          ${raw(ICONS[icon])}
        </svg>
      </div>
      ${body}
    </main>
  </body>
</html>`;

export type ErrorKind = "notFound" | "expired" | "throttled";

export const errorPage = (locale: Locale, kind: ErrorKind) => {
  const t = STRINGS[locale];
  const copy = {
    notFound: [t.notFoundTitle, t.notFoundBody],
    expired: [t.expiredTitle, t.expiredBody],
    throttled: [t.throttledTitle, t.throttledBody],
  }[kind];
  return shell(locale, copy[0], kind, html`<h1>${copy[0]}</h1>
    <p>${copy[1]}</p>`);
};

/**
 * A plain form posting back to the same URL. It used to be a script that
 * hashed the password in the browser and put the digest in the query string,
 * which read as privacy but was the opposite: the digest was accepted as-is,
 * so the URL in history, logs and Referer headers *was* the credential.
 * The password now travels in a POST body and never appears in a URL at all.
 */
export const passwordPage = (
  locale: Locale,
  token: string,
  wrongPassword: boolean
) => {
  const t = STRINGS[locale];
  return shell(
    locale,
    t.passwordTitle,
    "password",
    html`<h1>${t.passwordTitle}</h1>
      <p>${t.passwordBody}</p>
      <form method="post" action="/s/${token}">
        <input
          type="password"
          name="password"
          placeholder="${t.passwordPlaceholder}"
          autocomplete="off"
          autofocus
        />
        ${wrongPassword ? html`<div class="err">${t.passwordWrong}</div>` : ""}
        <button type="submit">${t.passwordSubmit}</button>
      </form>`
  );
};
