// The game's version for the main menu's "TUNNELER x.y.z": build.js puts package.json's version in at
// bundle time (esbuild define TUNNELER_BUILD_VERSION); unbundled (src/ served as is, tests) it is unknown.
/* global TUNNELER_BUILD_VERSION */
export const VERSION = typeof TUNNELER_BUILD_VERSION !== "undefined" ? TUNNELER_BUILD_VERSION : null;
