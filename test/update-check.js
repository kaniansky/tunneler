"use strict";
// New versions: the server's release check (server.js newerVersion / latestRelease), the desktop app's
// updater manifest (tools/updater-manifest.js) and its main menu item (home.js with a stub __TAURI__).
//   node test/update-check.js
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), vm = require("vm");
const SRC = path.join(__dirname, "..", "src");
const { newerVersion, latestRelease, langBundle, modesBundle } = require("../server.js");
const { manifest } = require("../tools/updater-manifest.js");

let n = 0;
const ok = msg => { n++; console.log("  ok  " + msg); };

(async () => {
  // ---------------------------------------------------------------- server: version compare
  assert(newerVersion("2.1.0", "2.0.0") && newerVersion("v2.0.1", "2.0.0") && newerVersion("10.0.0", "9.9.9"));
  assert(!newerVersion("2.0.0", "2.0.0") && !newerVersion("1.9.9", "2.0.0") && !newerVersion("x", "2.0.0") && !newerVersion("2.1.0", null));
  assert(!newerVersion("2.1.0-rc1", "2.1.0") && newerVersion("2.1.0", "2.1.0-rc1"));
  ok("newerVersion: semantic order, pre-releases older, junk never newer");

  // ---------------------------------------------------------------- server: GitHub's answer
  const answer = (status, body) => async () => ({ ok: status === 200, json: async () => body });
  assert.deepStrictEqual(await latestRelease("2.0.0", answer(200, { tag_name: "v2.1.0", html_url: "https://x/v2.1.0" })),
    { version: "2.1.0", url: "https://x/v2.1.0" });
  assert.strictEqual(await latestRelease("2.1.0", answer(200, { tag_name: "v2.1.0" })), null, "same version");
  assert.strictEqual(await latestRelease("2.0.0", answer(404, {})), null, "no release");
  assert.strictEqual(await latestRelease("2.0.0", async () => { throw new Error("offline"); }), null, "offline");
  assert.strictEqual(await latestRelease(null, answer(200, { tag_name: "v9.0.0" })), null, "unknown own version");
  ok("latestRelease: a newer release -> {version, url}; same, none, offline -> null");

  // ---------------------------------------------------------------- updater manifest
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tunneler-upd-"));
  const put = (f, s) => fs.writeFileSync(path.join(dir, f), s);
  assert.strictEqual(manifest(dir, "v2.1.0", "o/r"), null, "nothing signed");
  put("tunneler-online-2.1.0-windows-x64.exe", "x");
  put("tunneler-online-2.1.0-windows-x64-setup.exe", "x"); put("tunneler-online-2.1.0-windows-x64-setup.exe.sig", "SIGW\n");
  put("tunneler-online-2.1.0-linux-x64.AppImage", "x"); put("tunneler-online-2.1.0-linux-x64.AppImage.sig", "SIGL");
  put("tunneler-online-2.1.0-macos-arm64.app.tar.gz", "x"); put("tunneler-online-2.1.0-macos-arm64.app.tar.gz.sig", "SIGA");
  put("tunneler-online-2.1.0-macos-x64.app.tar.gz.sig", "orphan");          // (its package is missing)
  const m = manifest(dir, "v2.1.0", "o/r", new Date("2026-10-18T10:00:00.123Z"));
  assert.strictEqual(m.version, "2.1.0"); assert.strictEqual(m.pub_date, "2026-10-18T10:00:00Z");
  assert.deepStrictEqual(Object.keys(m.platforms).sort(), ["darwin-aarch64", "linux-x86_64", "linux-x86_64-appimage", "windows-x86_64"]);
  assert.deepStrictEqual(m.platforms["windows-x86_64"],
    { signature: "SIGW", url: "https://github.com/o/r/releases/download/v2.1.0/tunneler-online-2.1.0-windows-x64-setup.exe" });
  // deb / rpm: their own entries (an app installed from a package updates with the same kind)
  put("tunneler-online-2.1.0_amd64.deb", "x"); put("tunneler-online-2.1.0_amd64.deb.sig", "SIGD");
  put("tunneler-online-2.1.0.x86_64.rpm", "x"); put("tunneler-online-2.1.0.x86_64.rpm.sig", "SIGR");
  const pk = manifest(dir, "v2.1.0", "o/r");
  assert.strictEqual(pk.platforms["linux-x86_64-deb"].url.split("/").pop(), "tunneler-online-2.1.0_amd64.deb");
  assert.strictEqual(pk.platforms["linux-x86_64-rpm"].signature, "SIGR");
  assert.strictEqual(pk.platforms["linux-x86_64"].url.split("/").pop(), "tunneler-online-2.1.0-linux-x64.AppImage", "plain linux = the AppImage");
  // ARM64 Linux: its deb / rpm (no AppImage, so no plain linux-aarch64)
  put("tunneler-online-2.1.0_arm64.deb", "x"); put("tunneler-online-2.1.0_arm64.deb.sig", "SIGAD");
  put("tunneler-online-2.1.0.aarch64.rpm", "x"); put("tunneler-online-2.1.0.aarch64.rpm.sig", "SIGAR");
  const arm = manifest(dir, "v2.1.0", "o/r");
  assert.strictEqual(arm.platforms["linux-aarch64-deb"].url.split("/").pop(), "tunneler-online-2.1.0_arm64.deb");
  assert.strictEqual(arm.platforms["linux-aarch64-rpm"].signature, "SIGAR");
  assert(!arm.platforms["linux-aarch64"], "no ARM64 AppImage: no plain linux-aarch64");
  // the AppImage without a version in its name (3.1.3 on): the same entries
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "tunneler-upd-"));
  fs.writeFileSync(path.join(d2, "tunneler-online-linux-x64.AppImage.sig"), "SIGN");
  const nv = manifest(d2, "v2.1.0", "o/r", new Date(), ["tunneler-online-linux-x64.AppImage"]);
  assert.strictEqual(nv.platforms["linux-x86_64"].url, "https://github.com/o/r/releases/download/v2.1.0/tunneler-online-linux-x64.AppImage");
  assert.strictEqual(nv.platforms["linux-x86_64-appimage"].signature, "SIGN");
  fs.rmSync(d2, { recursive: true });
  // (updater-manifest.yml: only the .sig files here, the packages named by the release's file list)
  fs.rmSync(path.join(dir, "tunneler-online-2.1.0-linux-x64.AppImage"));
  assert(!manifest(dir, "v2.1.0", "o/r").platforms["linux-x86_64"], "no package, no list: left out");
  const listed = manifest(dir, "v2.1.0", "o/r", new Date(), ["tunneler-online-2.1.0-linux-x64.AppImage"]);
  assert.strictEqual(listed.platforms["linux-x86_64"].signature, "SIGL", "listed in the release: in");
  fs.rmSync(dir, { recursive: true });
  ok("updater manifest: one entry per signed package, release URLs, no entry without the package");

  // ---------------------------------------------------------------- desktop app: main menu item
  async function home(protocol, check) {
    const listeners = {}, calls = [];
    const mkEl = id => ({ id, width: 720, height: 400, style: {}, classList: { toggle() {} },
      addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 720, height: 400 }),
      getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }) });
    const elements = {}, storage = new Map();
    const win = {
      document: { title: "", getElementById: id => elements[id] || (elements[id] = mkEl(id)), createElement: mkEl },
      location: { protocol, hostname: "localhost", host: "localhost", origin: protocol + "//localhost", search: "", pathname: "/", hash: "", href: "" },
      history: { replaceState() {} },
      localStorage: { getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) },
      addEventListener: (t, f) => (listeners[t] = listeners[t] || []).push(f),
      requestAnimationFrame: () => 0, cancelAnimationFrame() {},
      performance, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, console, URLSearchParams, URL, Math, atob, Uint8Array,
      __TAURI__: { core: { invoke: async (cmd) => { calls.push(cmd); if (cmd === "update_check") return check; if (cmd === "update_install") throw "no network"; return null; } } },
    };
    win.window = win; win.globalThis = win;
    const ctx = vm.createContext(win);
    for (const [, src] of fs.readFileSync(path.join(SRC, "index.html"), "utf8").matchAll(/<script src="\/([^"]+)"/g))
      vm.runInContext(src === "js/langs.js" ? langBundle(path.join(SRC, "lang")) : src === "js/modes.js" ? modesBundle(path.join(SRC, "js", "modes"))
        : fs.readFileSync(path.join(SRC, src), "utf8"), ctx, { filename: src });
    await new Promise(r => setTimeout(r, 0));
    return { ui: win.tunnelerHomeUI(), calls };
  }
  const item = ui => ui.spec.items.find(it => it.key === "update");
  {
    const { ui, calls } = await home("http:", { version: "9.0.0", install: true });
    assert(!item(ui) && !calls.length, "a browser asks nobody");
  }
  {
    const { ui, calls } = await home("tauri:", null);
    assert.deepStrictEqual(calls, ["update_check"]); assert(!item(ui), "no update: no item");
  }
  {
    const { ui, calls } = await home("tauri:", { version: "9.0.0", install: true });
    const it = item(ui);
    assert(it && ui.spec.home && ui.spec.infoRow === 21, "the item below Settings, the info lower");
    assert(/9\.0\.0/.test(it.label));
    it.go();
    assert.deepStrictEqual(calls, ["update_check", "update_install"]);
    await new Promise(r => setTimeout(r, 0));
    assert(item(ui).info[0].text.includes("no network"), "a failed update shows why");
    const p = await home("tauri:", { version: "9.0.0", install: false });
    item(p.ui).go();
    assert.deepStrictEqual(p.calls, ["update_check", "update_page"], "can't replace itself: the download page");
  }
  ok("desktop app main menu: 'Update to version X' installs, else opens the download page; browsers never ask");

  console.log(`update-check: ${n} ok`);
})().catch(e => { console.error(e); process.exit(1); });
