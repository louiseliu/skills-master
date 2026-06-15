import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en";
import zhCN from "./zh-CN";

/**
 * Dev-only: log every missing-key event so HMR-induced stale state (esp. in
 * Tauri's webview, which sometimes hangs on to old translation modules) is
 * obvious in DevTools instead of silently rendering a SCREAMING.KEY.PATH.
 * Stripped at production build time via Vite's `import.meta.env.DEV` guard.
 */
const isDev = import.meta.env.DEV;

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    "zh-CN": { translation: zhCN },
  },
  lng: "zh-CN",
  fallbackLng: "zh-CN",
  interpolation: {
    escapeValue: false, // React 已做 XSS 转义
  },
  debug: isDev,
  saveMissing: isDev,
  missingKeyHandler: isDev
    ? (lngs, ns, key) => {
        console.warn(
          `[i18n missing] lng=${lngs.join(",")} ns=${ns} key="${key}"`,
        );
      }
    : undefined,
});

/**
 * HMR hot-reload bridge: when a translation module updates, re-seed i18next's
 * in-memory bundle and force a refresh. Without this, edits to zh-CN.ts trigger
 * a Vite "page reload" event but i18next itself keeps the old resource bundle
 * (it was loaded once at boot from frozen imports), so newly-added keys still
 * resolve to their key path.
 */
if (import.meta.hot) {
  import.meta.hot.accept(["./en", "./zh-CN"], (mods) => {
    const [nextEn, nextZh] = mods;
    if (nextEn?.default) {
      i18n.addResourceBundle("en", "translation", nextEn.default, true, true);
    }
    if (nextZh?.default) {
      i18n.addResourceBundle("zh-CN", "translation", nextZh.default, true, true);
    }
    void i18n.reloadResources().then(() => i18n.changeLanguage(i18n.language));
  });
}

export default i18n;
