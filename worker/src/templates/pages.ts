import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { Locale } from "../lib/locale";

/** Strings for server-rendered share pages, keyed by locale. */
const STRINGS = {
  en: {
    notFoundTitle: "Link not found",
    notFoundBody: "This share link is invalid or has been deleted.",
    expiredTitle: "Link expired",
    expiredBody: "This share link has expired.",
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
    expiredBody: "这个分享链接已经过期。",
    passwordTitle: "需要访问密码",
    passwordBody: "这是一个受密码保护的分享。",
    passwordPlaceholder: "输入密码",
    passwordWrong: "密码错误，请重试",
    passwordSubmit: "查看",
  },
} satisfies Record<Locale, Record<string, string>>;

/** Frosted-glass shell matching the SPA look, for server-rendered share pages. */
const shell = (
  locale: Locale,
  title: string,
  body: HtmlEscapedString | Promise<HtmlEscapedString>
) => html`<!doctype html>
<html lang="${locale === "zh" ? "zh-CN" : "en"}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/svg+xml" href="/logo.svg" />
    <title>${title} · PicNest</title>
    <style>
      * { box-sizing: border-box; }
      body {
        min-height: 100svh; margin: 0; display: grid; place-items: center;
        background: #fafafa; color: #262626;
        font-family: "SF Compact", -apple-system, BlinkMacSystemFont, "Segoe UI",
          Roboto, Helvetica, Arial, sans-serif;
      }
      .card {
        width: min(360px, calc(100% - 32px)); padding: 32px; text-align: center;
        border-radius: 20px; border: 1px solid rgb(255 255 255 / 0.8);
        background: rgb(255 255 255 / 0.6);
        backdrop-filter: blur(16px) saturate(180%);
        -webkit-backdrop-filter: blur(16px) saturate(180%);
        box-shadow: 0 1px 2px rgb(0 0 0 / 0.06), 0 6px 12px rgb(0 0 0 / 0.06),
          0 18px 32px rgb(0 0 0 / 0.07);
      }
      h1 { margin: 0 0 8px; font-size: 16px; font-weight: 600; }
      p { margin: 0; color: #737373; font-size: 13px; line-height: 20px; }
      input {
        width: 100%; margin-top: 20px; padding: 10px 14px; font-size: 14px;
        border: 1px solid #e5e5e5; border-radius: 12px; outline: none; background: white;
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
    <div class="card">${body}</div>
  </body>
</html>`;

export const errorPage = (
  locale: Locale,
  kind: "notFound" | "expired"
) => {
  const t = STRINGS[locale];
  const title = kind === "notFound" ? t.notFoundTitle : t.expiredTitle;
  const body = kind === "notFound" ? t.notFoundBody : t.expiredBody;
  return shell(locale, title, html`<h1>${title}</h1><p>${body}</p>`);
};

export const passwordPage = (locale: Locale, wrongPassword: boolean) => {
  const t = STRINGS[locale];
  return shell(
    locale,
    t.passwordTitle,
    html`<h1>${t.passwordTitle}</h1>
      <p>${t.passwordBody}</p>
      <form id="f">
        <input id="pw" type="password" placeholder="${t.passwordPlaceholder}" autofocus />
        ${wrongPassword ? html`<div class="err">${t.passwordWrong}</div>` : ""}
        <button type="submit">${t.passwordSubmit}</button>
      </form>
      <script>
        // The password never leaves the browser in plaintext: it is hashed
        // client-side and compared against the stored SHA-256 server-side.
        document.getElementById("f").addEventListener("submit", async (e) => {
          e.preventDefault();
          const value = document.getElementById("pw").value;
          const digest = await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(value)
          );
          const hex = [...new Uint8Array(digest)]
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          location.search = "?p=" + hex;
        });
      </script>`
  );
};
