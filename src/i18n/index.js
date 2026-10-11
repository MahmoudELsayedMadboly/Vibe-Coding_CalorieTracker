// Minimal translation layer. Translations live in src/locales/<lang>.json
// in i18next's format (nested keys, {{name}} interpolation, plural keys
// suffixed _zero/_one/_two/_few/_many/_other), so moving to i18next later
// stays mechanical. English is bundled; Arabic is a separate chunk loaded
// the first time it's chosen (the service worker precaches it for offline).
//
// `npm run i18n:check` keeps the two files in sync with each other and with
// the t("...") calls in the code.

import { useSyncExternalStore } from "react";
import en from "../locales/en.json";

export const LANGUAGES = ["en", "ar"];
export const DEFAULT_LANGUAGE = "en";

// Read before login (and by the inline script in index.html, which sets
// <html lang/dir> before the bundle loads so the login screen doesn't flash
// in the wrong direction). Keep the key in sync with index.html.
const STORAGE_KEY = "lang";

const RTL_LANGUAGES = new Set(["ar"]);

// Saudi Arabic conventions, but always the Gregorian calendar (ar-SA
// defaults to the Islamic one) and Western 0-9 digits. English keeps the
// browser's default locale, as before localization.
const INTL_LOCALES = { en: undefined, ar: "ar-SA-u-ca-gregory-nu-latn" };

const LOADERS = {
  ar: () => import("../locales/ar.json"),
};

// Unicode first-strong isolate / pop directional isolate. Every value
// interpolated into a sentence is wrapped in these so an English name or
// email inside an Arabic sentence (or the reverse) keeps its own direction
// without reordering the words around it. They're invisible.
const FSI = "⁨";
const PDI = "⁩";

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

const dictionaries = { en: flatten(en) };
const pluralRules = {};
const warnedKeys = new Set();
const listeners = new Set();

let currentLanguage = DEFAULT_LANGUAGE;
let switchSeq = 0;

function pluralFor(lang, count) {
  if (!pluralRules[lang]) pluralRules[lang] = new Intl.PluralRules(lang);
  return pluralRules[lang].select(count);
}

function lookup(lang, key, vars) {
  const dict = dictionaries[lang];
  if (!dict) return undefined;
  if (vars && typeof vars.count === "number") {
    const form = dict[`${key}_${pluralFor(lang, vars.count)}`];
    if (form != null) return form;
    if (dict[`${key}_other`] != null) return dict[`${key}_other`];
  }
  return dict[key];
}

function interpolate(text, vars) {
  if (!vars) return text;
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name) => {
    if (!(name in vars)) return match;
    const value = vars[name];
    if (typeof value === "number") return String(value);
    return `${FSI}${value == null ? "" : value}${PDI}`;
  });
}

// t("auth.logIn"), t("pagination.pageOf", { page: 2, total: 5 }),
// t("reminders.count", { count: n }). A key missing from the current
// language falls back to English; a key missing everywhere shows the key
// itself (and warns once in development) so it's easy to spot.
export function t(key, vars) {
  let text = lookup(currentLanguage, key, vars);
  if (text == null && currentLanguage !== DEFAULT_LANGUAGE) text = lookup(DEFAULT_LANGUAGE, key, vars);
  if (text == null) {
    if (import.meta.env.DEV && !warnedKeys.has(key)) {
      warnedKeys.add(key);
      console.warn(`[i18n] Missing translation key: ${key}`);
    }
    return key;
  }
  return interpolate(text, vars);
}

export function getLanguage() {
  return currentLanguage;
}

export function isRTL() {
  return RTL_LANGUAGES.has(currentLanguage);
}

// Pass to toLocaleDateString / toLocaleTimeString / Intl.* in place of [].
export function intlLocale() {
  return INTL_LOCALES[currentLanguage];
}

// For icons that point somewhere (Send, chevrons): mirrored in RTL.
export function mirrorInRTL() {
  return isRTL() ? { transform: "scaleX(-1)" } : undefined;
}

export function normalizeLanguage(value) {
  return LANGUAGES.includes(value) ? value : null;
}

export function readStoredLanguage() {
  try {
    return normalizeLanguage(window.localStorage.getItem(STORAGE_KEY));
  } catch (_) {
    return null;
  }
}

function applyToDocument() {
  const root = document.documentElement;
  root.lang = currentLanguage;
  root.dir = isRTL() ? "rtl" : "ltr";
  document.title = t("app.title");
}

function emit() {
  listeners.forEach((fn) => fn());
}

// Loads the language if needed, then switches the whole app to it and
// remembers it on this device. Rejects (leaving the current language in
// place) if the translation file can't be loaded, e.g. offline before the
// service worker has cached it.
export async function setLanguage(next) {
  const lang = normalizeLanguage(next) || DEFAULT_LANGUAGE;
  const seq = ++switchSeq;
  if (!dictionaries[lang]) {
    const mod = await LOADERS[lang]();
    dictionaries[lang] = flatten(mod.default);
  }
  // A later call won the race while this one was loading.
  if (seq !== switchSeq) return;

  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch (_) {
    // Private mode / storage disabled: the choice just won't survive a reload.
  }
  if (lang === currentLanguage) {
    applyToDocument();
    return;
  }
  currentLanguage = lang;
  applyToDocument();
  emit();
}

// Called once before the first render with the device's saved choice.
export async function initI18n() {
  const stored = readStoredLanguage();
  try {
    await setLanguage(stored || DEFAULT_LANGUAGE);
  } catch (err) {
    console.error("[i18n] Couldn't load the saved language; using English:", err);
    currentLanguage = DEFAULT_LANGUAGE;
    applyToDocument();
  }
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Re-renders the calling component when the language changes. The app root
// calls it, and since nothing below it is memoized, the whole tree follows.
export function useLanguage() {
  return useSyncExternalStore(subscribe, getLanguage);
}
