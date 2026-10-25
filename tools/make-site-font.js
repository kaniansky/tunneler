// Builds a web font from the game's own IBM VGA 8x16 ROM font (src/js/vgafont.js) plus the extra
// letters of src/js/glyphs.js (Latin Extended, Cyrillic, punctuation): site/fonts/vga.woff.
// Every pixel is a square of 64 units (1/16 em), cells 9 pixels wide as on a VGA text screen.
// The homepage's headings and title use it (site/index.html).
//   npm install --no-save opentype.js && node tools/make-site-font.js [out.woff]   (default site/fonts/vga.woff)
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const opentype = require("opentype.js");
const repo = path.join(__dirname, ".."), out = process.argv[2] || path.join(repo, "site", "fonts", "vga.woff");
const vgaSrc = fs.readFileSync(path.join(repo, "src/js/vgafont.js"), "utf8");
const b64 = vgaSrc.match(/const b64 = "([^"]+)"/)[1];
const rom = Buffer.from(b64, "base64");
const gSrc = fs.readFileSync(path.join(repo, "src/js/glyphs.js"), "utf8");
const cp437 = JSON.parse(gSrc.match(/CP437_CHARS = ("(?:[^"\\]|\\.)*")/)[1]);
const extra = JSON.parse(gSrc.match(/const g = (\{[^}]*\})/)[1]);

const U = 64, ASC = 12 * U, DESC = 4 * U;
const glyphs = new Map(); // code point -> {rows, box}
// CP437 bytes 32..255 (their Unicode characters), and a few control-range symbols
const low = { 0x10: 0x25BA, 0x11: 0x25C4, 0x18: 0x2191, 0x19: 0x2193, 0x1A: 0x2192, 0x1B: 0x2190, 0x1E: 0x25B2, 0x1F: 0x25BC, 0x07: 0x2022 };
for (let b = 0; b < 256; b++) {
  const cp = b >= 32 ? cp437.charCodeAt(b) : low[b];
  if (cp == null || b === 0xFF) continue;
  glyphs.set(cp, { rows: rom.subarray(b * 16, b * 16 + 16), box: b >= 0xC0 && b <= 0xDF });
}
for (const [ch, data] of Object.entries(extra)) {
  const cp = ch.codePointAt(0);
  if (!glyphs.has(cp)) glyphs.set(cp, { rows: Buffer.from(data, "base64"), box: false });
}
glyphs.set(0xA0, glyphs.get(0x20));

function pathOf(rows, box) {
  const p = new opentype.Path();
  // runs per row, merged downwards while identical
  const open = new Map(); // "x0,x1" -> top row
  const rects = [];
  const runsOf = r => {
    const bits = [];
    for (let c = 0; c < 8; c++) bits.push((rows[r] >> (7 - c)) & 1);
    bits.push(box ? bits[7] : 0);
    const runs = [];
    for (let c = 0; c < 9;) {
      if (!bits[c]) { c++; continue; }
      let e = c; while (e < 9 && bits[e]) e++;
      runs.push(c + "," + e); c = e;
    }
    return runs;
  };
  for (let r = 0; r <= 16; r++) {
    const runs = r < 16 ? new Set(runsOf(r)) : new Set();
    for (const [k, top] of [...open]) if (!runs.has(k)) { rects.push([k, top, r]); open.delete(k); }
    for (const k of runs) if (!open.has(k)) open.set(k, r);
  }
  for (const [k, r0, r1] of rects) {
    const [x0, x1] = k.split(",").map(Number);
    const X0 = x0 * U, X1 = x1 * U, Y0 = ASC - r1 * U, Y1 = ASC - r0 * U;
    // counter-clockwise (CFF outer contour)
    p.moveTo(X0, Y1); p.lineTo(X0, Y0); p.lineTo(X1, Y0); p.lineTo(X1, Y1); p.close();
  }
  return p;
}

const list = [new opentype.Glyph({ name: ".notdef", unicode: undefined, advanceWidth: 9 * U, path: new opentype.Path() })];
for (const [cp, g] of [...glyphs].sort((a, b) => a[0] - b[0])) {
  list.push(new opentype.Glyph({ name: "u" + cp.toString(16).toUpperCase().padStart(4, "0"), unicode: cp,
    advanceWidth: 9 * U, path: pathOf(g.rows, g.box) }));
}
const font = new opentype.Font({ familyName: "Tunneler VGA", styleName: "Regular", unitsPerEm: 16 * U,
  ascender: ASC, descender: -DESC, glyphs: list,
  copyright: "IBM VGA 8x16 ROM font; extra letters from the Linux console font Uni2-VGA16",
  designer: "IBM; Tunneler Online", version: "1.0" });
const otf = Buffer.from(font.toArrayBuffer());

// WOFF 1.0 wrapper (zlib per table)
function woff(sfnt) {
  const num = sfnt.readUInt16BE(4), flavor = sfnt.readUInt32BE(0);
  const tables = [];
  for (let i = 0; i < num; i++) {
    const o = 12 + i * 16;
    const tag = sfnt.toString("latin1", o, o + 4), sum = sfnt.readUInt32BE(o + 4), off = sfnt.readUInt32BE(o + 8), len = sfnt.readUInt32BE(o + 12);
    const data = sfnt.subarray(off, off + len), z = zlib.deflateSync(data, { level: 9 });
    tables.push({ tag, sum, len, data: z.length < len ? z : data });
  }
  let offset = 44 + num * 20;
  const dir = Buffer.alloc(num * 20), bodies = [];
  tables.forEach((t, i) => {
    dir.write(t.tag, i * 20, "latin1"); dir.writeUInt32BE(offset, i * 20 + 4); dir.writeUInt32BE(t.data.length, i * 20 + 8);
    dir.writeUInt32BE(t.len, i * 20 + 12); dir.writeUInt32BE(t.sum, i * 20 + 16);
    const pad = (4 - (t.data.length % 4)) % 4;
    bodies.push(t.data, Buffer.alloc(pad)); offset += t.data.length + pad;
  });
  const head = Buffer.alloc(44);
  head.write("wOFF", 0, "latin1"); head.writeUInt32BE(flavor, 4); head.writeUInt32BE(offset, 8); head.writeUInt16BE(num, 12);
  head.writeUInt32BE(12 + 16 * num + tables.reduce((a, t) => a + ((t.len + 3) & ~3), 0), 16); head.writeUInt16BE(1, 20);
  return Buffer.concat([head, dir, ...bodies]);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, woff(otf));
console.log(glyphs.size, "glyphs,", otf.length, "bytes otf,", fs.statSync(out).size, "bytes woff");
