"use strict";
// The game's modules for node tests. src/ is ES modules (src/package.json); node >= 20.19 requires them as
// they are (one module instance each, shared with any import). Loading this also loads every language
// (src/lang/index.js) and game mode (src/js/modes/index.js) - what a page's entry does - and lets UniFont read
// the Unifont blocks from disk (a page fetches them).
//   const { TunnelerEngine, TunnelerAI, NetProto, Lang } = require("./src.js");
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "src");
const mod = f => require(path.join(SRC, "js", f));

const { TunnelerEngine } = mod("engine.js");
const { TunnelerAI } = mod("ai.js");
const { NetProto } = mod("netproto.js");
const { Lang } = mod("lang.js");
const { UniText, UniFont } = mod("unitext.js");
const { CpuCode } = mod("cpucode.js");
const { MapData } = mod("mapdata.js");
const { Speaker } = mod("speaker.js");
const { VGA_FONT } = mod("vgafont.js");
const { CP437_CHARS, EXTRA_GLYPHS, unicodeGlyph } = mod("glyphs.js");
const { UNI_DATA } = mod("unidata.js");
const { STRINGS_EN } = require(path.join(SRC, "lang", "en", "engine.js"));
require(path.join(SRC, "lang", "index.js"));
require(path.join(SRC, "js", "modes", "index.js"));

// a Unifont block from src/fonts/unifont/ (null: no such file)
const readBlock = b => { try { return fs.readFileSync(path.join(SRC, "fonts", "unifont", UniFont.blockName(b))); } catch (e) { return null; } };
UniFont.loader = readBlock;

// every language folder's .js files and every game mode file (index.js excluded), for the checks that the
// index modules leave nothing out
const langFolders = () => fs.readdirSync(path.join(SRC, "lang")).filter(c => fs.statSync(path.join(SRC, "lang", c)).isDirectory()).sort();
const jsIn = d => fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith(".js") && f !== "index.js").sort() : [];

module.exports = { SRC, TunnelerEngine, TunnelerAI, NetProto, Lang, UniText, UniFont, CpuCode, MapData, Speaker, VGA_FONT, CP437_CHARS,
  EXTRA_GLYPHS, unicodeGlyph, UNI_DATA, STRINGS_EN, readBlock, langFolders, jsIn };
