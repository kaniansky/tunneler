// Every language (docs/DESIGN-8P.md 24): one folder per language with its own index.js; English first (the
// fallback), then alphabetically - the Language: menu's order comes from each main.js's `order` (lang.js).
// A new language: its folder, its index.js and a line here (test/lang-check.js checks that nothing is left out).
import "./en/index.js";
import "./cs/index.js";
import "./ru/index.js";
import "./sk/index.js";
import "./uk/index.js";
