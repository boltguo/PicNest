import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import en from "./locales/en";
import zh from "./locales/zh";

// Detection order: user's explicit choice (localStorage) wins over the
// browser language; English is the default for everything else.
//
// The choice is also mirrored into a cookie, which is the only copy the Worker
// can read: server-rendered share pages would otherwise fall back to
// Accept-Language and come out in a different language than the app itself.
void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
    fallbackLng: "en",
    supportedLngs: ["en", "zh"],
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "cookie", "navigator"],
      caches: ["localStorage", "cookie"],
      lookupLocalStorage: "picnest-lang",
      lookupCookie: "picnest-lang",
      cookieMinutes: 525_600, // one year
      // Lax still travels on the top-level navigation to /s/…, which is the
      // only request that reads it.
      cookieOptions: { path: "/", sameSite: "lax" },
    },
  });

export default i18n;
