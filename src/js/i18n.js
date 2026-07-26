"use strict"

// Client-side i18n, no server involvement - every string here is either static chrome
// (buttons/labels/placeholders, applied via data-i18n* attributes) or built at runtime by
// tunneler.js/spectator.js/lobby.js via t(). Language choice is remembered in
// localStorage so it survives reloads/navigating between session pages.
//
// Translation strings live in src/lang/<code>.json (copied through to public/lang/
// unchanged by build.js, same as any other non-js/css asset); each also carries a
// "_label" key (the short code shown in the lang <select>, e.g. "EN"). build.js derives
// public/lang/index.json - {code: label, ...} - from whatever *.json files exist in
// src/lang/, so the supported-language set lives in the filesystem, not hardcoded here.
// t() is called synchronously by other classic scripts as soon as they parse (e.g.
// tunneler.js builds its default blue/green names at top level, before
// DOMContentLoaded), so both the manifest and the current language's json have to be
// loaded synchronously too, right here, before this script finishes - a normal (async)
// fetch() can't guarantee that ordering.

function loadJsonSync(url)
{
  const xhr = new XMLHttpRequest();
  xhr.open("GET", url, false);
  xhr.send(null);
  return JSON.parse(xhr.responseText);
}

// {code: label, ...} - also doubles as the supported-language set (Object.keys)
const LANG_LABELS = loadJsonSync("/lang/index.json");
const SUPPORTED_LANGS = Object.keys(LANG_LABELS);

function detectLang()
{
  const stored = localStorage.getItem("lang");
  if (stored && SUPPORTED_LANGS.includes(stored))
    return stored;
  const nav = (navigator.language || "en").slice(0, 2).toLowerCase();
  return SUPPORTED_LANGS.includes(nav) ? nav : "en";
}

let currentLang = detectLang();
// en always loaded up front as the fallback for missing keys in other languages;
// others are loaded lazily (here if currentLang isn't en, otherwise on-demand in
// setLang()) so a session never fetches every language's json for nothing.
const translations = { en: loadJsonSync("/lang/en.json") };
if (currentLang != "en")
  translations[currentLang] = loadJsonSync("/lang/" + currentLang + ".json");

// vars: {} of placeholder name -> value, substituted into "{name}" spots in the string.
function t(key, vars = {})
{
  let str = (translations[currentLang] && translations[currentLang][key]) || translations.en[key] || key;
  for (const k in vars)
    str = str.replace(new RegExp("\\{" + k + "\\}", "g"), vars[k]);
  return str;
}

// data-i18n -> textContent, data-i18n-placeholder -> placeholder attribute. Covers every
// static piece of chrome across index/lobby/tunneler/spectator.html; anything built from
// dynamic data (session/player names, scores) is composed with t() directly in the page's
// own JS instead, since a blanket textContent overwrite would clobber that data.
function applyI18n(root = document)
{
  root.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll("[data-i18n-placeholder]").forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
}

function setLang(lang)
{
  if (!SUPPORTED_LANGS.includes(lang) || lang == currentLang)
    return;
  if (!translations[lang])
    translations[lang] = loadJsonSync("/lang/" + lang + ".json");
  currentLang = lang;
  localStorage.setItem("lang", lang);
  applyI18n();
  // lets pages with their own dynamic/name-interpolated strings (lobby.js's Join
  // buttons) re-render without i18n.js needing to know about them
  document.dispatchEvent(new CustomEvent("langchange"));
}

// Appended to whatever .banner the current page has, rather than duplicated markup in
// every html file - all four pages (index/lobby/tunneler/spectator) share the same
// .banner class (see common.css).
function injectLangSwitcher()
{
  const banner = document.querySelector(".banner");
  if (!banner)
    return;
  const select = document.createElement("select");
  select.id = "langSelect";
  select.className = "lang-select";
  for (const lang of SUPPORTED_LANGS)
  {
    const opt = document.createElement("option");
    opt.value = lang;
    opt.textContent = LANG_LABELS[lang] || lang;
    opt.selected = lang == currentLang;
    select.appendChild(opt);
  }
  select.addEventListener("change", () => setLang(select.value));
  banner.appendChild(select);
}

document.addEventListener("DOMContentLoaded", () => {
  applyI18n();
  // only index.html gets the switcher - lobby/tunneler/spectator share the .banner
  // class too, but switching language mid-session isn't a thing they need to expose
  if (location.pathname == "/")
    injectLangSwitcher();
});
