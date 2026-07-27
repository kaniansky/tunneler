"use strict"

// Single source of truth for the 8 player colors - shared by engine-render.js
// (tank sprites + base borders, keyed by a tank's chosen color index) and
// lobby.js (color swatch picker), so the lobby preview always matches what a
// player's tank actually looks like in-game. Plain global (no bundler/modules
// in this codebase - see engine-constants.js's EngineConfig/FieldCell for the
// same convention), loaded before either consumer via a <script> tag.
const PLAYER_COLORS = [
  [0x2c, 0x2c, 0xfc], // blue
  [0x00, 0xfc, 0x00], // green
  [0xff, 0xcc, 0x33], // yellow
  [0xff, 0x33, 0x99], // pink
  [0x33, 0xdd, 0xff], // cyan
  [0xaa, 0x33, 0xff], // purple
  [0xff, 0x33, 0x33], // red
  [0xe8, 0xe8, 0xe8], // white
];
