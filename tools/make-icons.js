// The app's icon (owner, 2026-10-25: a blue tank seen from the side, flat colours with hard-edged light and
// shade, on earth) drawn as SVG and rendered in a headless Chromium into every place an icon lives:
//   src-tauri/app-icon.png                    1024, rounded (then: npx @tauri-apps/cli@2 icon src-tauri/app-icon.png
//                                             -o <tmp> and copy the files src-tauri/icons/ has but the Linux ones)
//   src-tauri/icons/32x32, 128x128, 128x128@2x.png   Linux (.deb, rpm, AppImage, the Flatpak): rounded at 80 % of
//                                             the canvas (Flathub's quality review: a rounded square that fills
//                                             it all is too big)
//   src/icons/icon-192/512.png                rounded (the installable web app, apple-touch-icon)
//   src/icons/maskable-192/512.png            full square, the tank inside the 80 % safe circle
//   src/favicon.ico, site/favicon.ico         16 / 32 / 48, rounded
//   site/img/icon.png                         256, rounded
//   docs/play-store/icon-512.png              full square (Play rounds it itself)
//   src-tauri/gen/android/.../mipmap-*/       ic_launcher (rounded), ic_launcher_round (a circle), and the
//                                             adaptive icon's ic_launcher_foreground (the tank inside the 66 %
//                                             safe zone, the ground across the whole width) on SKY
//                                             (res/values/ic_launcher_background.xml)
//   node tools/make-icons.js
// Needs playwright-core (not a dependency: npm i --no-save playwright-core) and a Chromium (CHROME, default:
// playwright's download in ~/.cache/ms-playwright), and Python 3 with Pillow (the .ico files, resizing).
"use strict";
const fs = require("fs"), os = require("os"), path = require("path"), { execFileSync } = require("child_process");
const { chromium } = require("playwright-core");
const CHROME = process.env.CHROME || (() => {
  const dir = path.join(os.homedir(), ".cache/ms-playwright");
  const d = fs.readdirSync(dir).filter(n => /^chromium-\d/.test(n)).sort().pop();
  return path.join(dir, d, "chrome-linux64/chrome");
})();
const ROOT = path.join(__dirname, "..");
const SKY = "#d48a3f", GROUND = "#6e3a17", GROUND_EDGE = "#8a4c1f";

const poly = (pts, fill) => `<polygon points="${pts.map(([x, y]) => x + "," + y).join(" ")}" fill="${fill}"/>`;
// the tank, facing right; its silhouette spans x 136..950, y 300..726 (the track's bottom: the ground line)
function tank() {
  const H = "#3050e0", HL = "#5f7dff", HD = "#2238b0", HX = "#172783";        // hull: base, lit, shade, deepest
  const TR = "#2b2d33", TRL = "#41444c", M = "#5d616b", MD = "#3b3e46", HUB = "#7b808b";
  const G = "#f2c81a", GD = "#c99a0a", GL = "#ffe46a";                       // the gun: yellow, as in the game
  const g = [];
  // tracks: the whole loop, the links of the bottom run
  g.push(`<rect x="150" y="600" width="630" height="126" rx="63" fill="${TR}"/>`);
  for (let x = 170; x < 770; x += 26) g.push(`<rect x="${x}" y="716" width="16" height="10" fill="${TRL}"/>`);
  // drive sprocket (rear) with its teeth, idler (front)
  for (let k = 0; k < 10; k++) g.push(`<rect x="194" y="610" width="18" height="18" fill="${MD}" transform="rotate(${k * 36} 203 662)"/>`);
  g.push(`<circle cx="203" cy="662" r="44" fill="${M}"/><circle cx="203" cy="662" r="26" fill="${MD}"/><circle cx="203" cy="662" r="10" fill="${HUB}"/>`);
  g.push(`<circle cx="727" cy="660" r="40" fill="${M}"/><circle cx="727" cy="660" r="22" fill="${MD}"/><circle cx="727" cy="660" r="9" fill="${HUB}"/>`);
  // road wheels, their lower halves in shade
  for (let k = 0; k < 6; k++) {
    const cx = 286 + k * 76;
    g.push(`<circle cx="${cx}" cy="676" r="38" fill="${M}"/><path d="M ${cx - 38} 676 A 38 38 0 0 0 ${cx + 38} 676 Z" fill="${MD}"/>`);
    g.push(`<circle cx="${cx}" cy="676" r="22" fill="${MD}"/><circle cx="${cx}" cy="676" r="9" fill="${HUB}"/>`);
  }
  // hull: rear plate, deck, sloped glacis; its lit top edge
  g.push(poly([[140, 548], [166, 528], [650, 528], [812, 574], [790, 600], [152, 600]], H));
  g.push(poly([[166, 528], [650, 528], [812, 574], [796, 584], [646, 542], [172, 542]], HL));
  // side skirts over the upper track run, their panel joints
  g.push(poly([[168, 586], [780, 586], [768, 640], [180, 640]], HD));
  for (let x = 268; x < 760; x += 98) g.push(`<rect x="${x}" y="586" width="5" height="54" fill="${HX}"/>`);
  g.push(`<rect x="168" y="586" width="612" height="7" fill="${H}"/>`);
  // headlight, tow hook
  g.push(`<rect x="772" y="566" width="22" height="12" rx="4" fill="#ffe680"/><rect x="136" y="560" width="14" height="22" rx="4" fill="${HX}"/>`);
  // turret: low and angular; its lit roof edge, the shade under it, a storage box on the bustle
  g.push(poly([[268, 528], [300, 452], [560, 440], [650, 468], [676, 512], [640, 532]], H));
  g.push(poly([[300, 452], [560, 440], [650, 468], [642, 478], [556, 452], [306, 464]], HL));
  g.push(poly([[268, 528], [640, 532], [676, 512], [668, 504], [634, 520], [276, 514]], HD));
  g.push(`<rect x="300" y="476" width="70" height="34" rx="4" fill="${HD}"/><rect x="306" y="482" width="58" height="5" fill="${H}"/>`);
  // commander's cupola, the sight, the antenna
  g.push(`<rect x="402" y="412" width="78" height="34" rx="8" fill="${H}"/><rect x="402" y="412" width="78" height="10" rx="5" fill="${HL}"/>`);
  g.push(`<rect x="500" y="420" width="34" height="24" rx="4" fill="${HD}"/><rect x="506" y="426" width="22" height="9" fill="#9fd4ff"/>`);
  g.push(`<line x1="292" y1="458" x2="214" y2="300" stroke="${HX}" stroke-width="5" stroke-linecap="round"/>`);
  // the gun: mantlet, barrel, fume extractor, muzzle brake
  g.push(`<rect x="640" y="470" width="50" height="50" rx="8" fill="${HD}"/>`);
  g.push(`<rect x="688" y="484" width="236" height="20" fill="${G}"/><rect x="688" y="484" width="236" height="6" fill="${GL}"/><rect x="688" y="498" width="236" height="6" fill="${GD}"/>`);
  g.push(`<rect x="780" y="478" width="52" height="32" rx="6" fill="${G}"/><rect x="780" y="478" width="52" height="8" rx="4" fill="${GL}"/><rect x="780" y="502" width="52" height="8" rx="4" fill="${GD}"/>`);
  g.push(`<rect x="918" y="479" width="32" height="30" rx="4" fill="${GD}"/><rect x="918" y="479" width="32" height="8" rx="3" fill="${G}"/>`);
  return g.join("\n");
}
// an icon: the tank (its silhouette's box centred) scaled by s about the middle, the ground below it;
// shape "rounded" | "square" | "circle", sky false = transparent (the adaptive icon's foreground)
function icon({ s = 1, shape = "rounded", sky = true }) {
  const dx = 512 - (136 + 950) / 2, dy = 512 - (300 + 726) / 2 + 20;
  const groundY = 512 + (726 + dy - 512) * s;
  const clip = shape === "rounded" ? `<rect width="1024" height="1024" rx="230"/>` : shape === "circle" ? `<circle cx="512" cy="512" r="512"/>` : `<rect width="1024" height="1024"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs><clipPath id="c">${clip}</clipPath></defs><g clip-path="url(#c)">
${sky ? `<rect width="1024" height="1024" fill="${SKY}"/>` : ""}
<rect x="0" y="${groundY}" width="1024" height="${1024 - groundY}" fill="${GROUND}"/><rect x="0" y="${groundY}" width="1024" height="${14 * s}" fill="${GROUND_EDGE}"/>
<g transform="translate(512 512) scale(${s}) translate(-512 -512) translate(${dx} ${dy})">${tank()}</g>
</g></svg>`;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tunneler-icons-"));
  const variants = {
    rounded: icon({}), square: icon({ shape: "square" }), maskable: icon({ shape: "square", s: 0.8 }),
    round: icon({ shape: "circle", s: 0.86 }), foreground: icon({ s: 0.66, sky: false, shape: "square" })
  };
  const b = await chromium.launch({ executablePath: CHROME });
  const p = await b.newPage({ viewport: { width: 1024, height: 1024 } });
  for (const [name, svg] of Object.entries(variants)) {
    fs.writeFileSync(path.join(tmp, name + ".svg"), svg);
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
    await p.screenshot({ path: path.join(tmp, name + ".png"), omitBackground: true, clip: { x: 0, y: 0, width: 1024, height: 1024 } });
  }
  await b.close();
  // the sizes (Pillow: good downscaling, .ico)
  const res = "src-tauri/gen/android/app/src/main/res";
  const py = `
import os, sys
from PIL import Image
T, R = sys.argv[1], sys.argv[2]
im = {n: Image.open(os.path.join(T, n + ".png")).convert("RGBA") for n in ("rounded", "square", "maskable", "round", "foreground")}
def put(name, size, rel, rgb=False):
    out = im[name].resize((size, size), Image.LANCZOS)
    if rgb: out = out.convert("RGB")
    os.makedirs(os.path.dirname(os.path.join(R, rel)), exist_ok=True); out.save(os.path.join(R, rel), optimize=True)
put("rounded", 1024, "src-tauri/app-icon.png")
for s in (192, 512): put("rounded", s, "src/icons/icon-%d.png" % s); put("maskable", s, "src/icons/maskable-%d.png" % s, True)
put("rounded", 256, "site/img/icon.png")
linux = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0)); small = im["rounded"].resize((820, 820), Image.LANCZOS); linux.paste(small, (102, 102), small)
for s, f in ((32, "32x32"), (128, "128x128"), (256, "128x128@2x")):
    linux.resize((s, s), Image.LANCZOS).save(os.path.join(R, "src-tauri/icons/%s.png" % f), optimize=True)
put("square", 512, "docs/play-store/icon-512.png", True)
for f in ("src/favicon.ico", "site/favicon.ico"):
    im["rounded"].resize((256, 256), Image.LANCZOS).save(os.path.join(R, f), sizes=[(16, 16), (32, 32), (48, 48)])
for d, s in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)):
    put("rounded", s, "${res}/mipmap-%s/ic_launcher.png" % d)
    put("round", s, "${res}/mipmap-%s/ic_launcher_round.png" % d)
    put("foreground", s * 108 // 48, "${res}/mipmap-%s/ic_launcher_foreground.png" % d)
print("icons written")
`;
  execFileSync("python3", ["-I", "-c", py, tmp, ROOT], { stdio: "inherit" });
  const bg = path.join(ROOT, res, "values/ic_launcher_background.xml");
  fs.writeFileSync(bg, fs.readFileSync(bg, "utf8").replace(/#[0-9A-Fa-f]{6}/, SKY.toUpperCase()));
  console.log("the SVGs: " + tmp + "\nnext: npx @tauri-apps/cli@2 icon src-tauri/app-icon.png -o <dir>, copy what src-tauri/icons/ has but 32x32, 128x128, 128x128@2x.png");
})().catch(e => { console.error(e); process.exit(1); });
