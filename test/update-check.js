"use strict";
// New versions: the server's release check (server.js newerVersion / latestRelease), the desktop app's
// updater manifest (tools/updater-manifest.js) and its main menu item (home.js with a stub __TAURI__).
//   node test/update-check.js
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), vm = require("vm");
const SRC = path.join(__dirname, "..", "src");
const { newerVersion, latestRelease, keepAwake } = require("../server.js");
const { runPage } = require("./page-env.js");
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
  put("tunneler-2.1.0-windows-x64.exe", "x");
  put("tunneler-2.1.0-windows-x64-setup.exe", "x"); put("tunneler-2.1.0-windows-x64-setup.exe.sig", "SIGW\n");
  put("tunneler-2.1.0-linux-x64.AppImage", "x"); put("tunneler-2.1.0-linux-x64.AppImage.sig", "SIGL");
  put("tunneler-2.1.0-macos-arm64.app.tar.gz", "x"); put("tunneler-2.1.0-macos-arm64.app.tar.gz.sig", "SIGA");
  put("tunneler-2.1.0-macos-x64.app.tar.gz.sig", "orphan");          // (its package is missing)
  const m = manifest(dir, "v2.1.0", "o/r", new Date("2026-10-18T10:00:00.123Z"));
  assert.strictEqual(m.version, "2.1.0"); assert.strictEqual(m.pub_date, "2026-10-18T10:00:00Z");
  assert.deepStrictEqual(Object.keys(m.platforms).sort(), ["darwin-aarch64", "linux-x86_64", "linux-x86_64-appimage", "windows-x86_64"]);
  assert.deepStrictEqual(m.platforms["windows-x86_64"],
    { signature: "SIGW", url: "https://github.com/o/r/releases/download/v2.1.0/tunneler-2.1.0-windows-x64-setup.exe" });
  // deb / rpm: their own entries (an app installed from a package updates with the same kind)
  put("tunneler-2.1.0_amd64.deb", "x"); put("tunneler-2.1.0_amd64.deb.sig", "SIGD");
  put("tunneler-2.1.0.x86_64.rpm", "x"); put("tunneler-2.1.0.x86_64.rpm.sig", "SIGR");
  const pk = manifest(dir, "v2.1.0", "o/r");
  assert.strictEqual(pk.platforms["linux-x86_64-deb"].url.split("/").pop(), "tunneler-2.1.0_amd64.deb");
  assert.strictEqual(pk.platforms["linux-x86_64-rpm"].signature, "SIGR");
  assert.strictEqual(pk.platforms["linux-x86_64"].url.split("/").pop(), "tunneler-2.1.0-linux-x64.AppImage", "plain linux = the AppImage");
  // ARM64 Linux: its deb / rpm (no AppImage, so no plain linux-aarch64)
  put("tunneler-2.1.0_arm64.deb", "x"); put("tunneler-2.1.0_arm64.deb.sig", "SIGAD");
  put("tunneler-2.1.0.aarch64.rpm", "x"); put("tunneler-2.1.0.aarch64.rpm.sig", "SIGAR");
  const arm = manifest(dir, "v2.1.0", "o/r");
  assert.strictEqual(arm.platforms["linux-aarch64-deb"].url.split("/").pop(), "tunneler-2.1.0_arm64.deb");
  assert.strictEqual(arm.platforms["linux-aarch64-rpm"].signature, "SIGAR");
  assert(!arm.platforms["linux-aarch64"], "no ARM64 AppImage: no plain linux-aarch64");
  // the AppImage without a version in its name (3.1.3 on): the same entries
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "tunneler-upd-"));
  fs.writeFileSync(path.join(d2, "tunneler-linux-x64.AppImage.sig"), "SIGN");
  const nv = manifest(d2, "v2.1.0", "o/r", new Date(), ["tunneler-linux-x64.AppImage"]);
  assert.strictEqual(nv.platforms["linux-x86_64"].url, "https://github.com/o/r/releases/download/v2.1.0/tunneler-linux-x64.AppImage");
  assert.strictEqual(nv.platforms["linux-x86_64-appimage"].signature, "SIGN");
  fs.rmSync(d2, { recursive: true });
  // (updater-manifest.yml: only the .sig files here, the packages named by the release's file list)
  fs.rmSync(path.join(dir, "tunneler-2.1.0-linux-x64.AppImage"));
  assert(!manifest(dir, "v2.1.0", "o/r").platforms["linux-x86_64"], "no package, no list: left out");
  const listed = manifest(dir, "v2.1.0", "o/r", new Date(), ["tunneler-2.1.0-linux-x64.AppImage"]);
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
    runPage(ctx, "index.html");
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
    // (screen.js asks the app's window whether it is fullscreen - Settings, Graphics)
    assert.deepStrictEqual(calls.filter(c => c !== "is_fullscreen"), ["update_check"]); assert(!item(ui), "no update: no item");
  }
  {
    const { ui, calls } = await home("tauri:", { version: "9.0.0", install: true });
    const it = item(ui);
    assert(it && ui.spec.home && ui.spec.infoRow === 22, "the item below Settings, the info lower");
    assert(/9\.0\.0/.test(it.label));
    it.go();
    assert.deepStrictEqual(calls.filter(c => c !== "is_fullscreen"), ["update_check", "update_install"]);
    await new Promise(r => setTimeout(r, 0));
    assert(item(ui).info[0].text.includes("no network"), "a failed update shows why");
    const p = await home("tauri:", { version: "9.0.0", install: false });
    item(p.ui).go();
    assert.deepStrictEqual(p.calls.filter(c => c !== "is_fullscreen"), ["update_check", "update_page"], "can't replace itself: the download page");
  }
  ok("desktop app main menu: 'Update to version X' installs, else opens the download page; browsers never ask");

  {
    // the Flatpak installs its metainfo from the release's tag: it lists package.json's version before tagging
    // (npm version X adds it: tools/flatpak-update.js --metainfo); the manifest's sources tell Flathub's bot
    // where new versions come from
    const v = require("../package.json").version, dir = path.join(__dirname, "..", "flatpak");
    const meta = fs.readFileSync(path.join(dir, "com.kaniansky.Tunneler.metainfo.xml"), "utf8");
    assert(meta.includes('<release version="' + v + '"'), "the Flatpak metainfo has no <release> for " + v + ": node tools/flatpak-update.js --metainfo " + v);
    // Flathub copies the screenshots from the metainfo's urls: this release's tag, not an older one's
    const shots = meta.match(/<image>[^<]*<\/image>/g) || [];
    assert(shots.length && shots.every(u => u.includes("/v" + v + "/screenshots/")), "the Flatpak metainfo's screenshots aren't from tag v" + v + ": node tools/flatpak-update.js --metainfo " + v);
    const man = fs.readFileSync(path.join(dir, "com.kaniansky.Tunneler.yml"), "utf8");
    assert.strictEqual((man.match(/x-checker-data:/g) || []).length, 3, "x-checker-data on both .deb sources and the git source");
    assert(/url: \S+_amd64\.deb\n\s+sha256: [0-9a-f]{64}/.test(man) && /url: \S+_arm64\.deb\n\s+sha256: [0-9a-f]{64}/.test(man) && /tag: v\S+\n\s+commit: [0-9a-f]{40}/.test(man),
      "the lines tools/flatpak-update.js rewrites are there");
  }
  ok("the Flatpak: the metainfo lists this version and its screenshots, the manifest's sources (x-checker-data, the lines the release job rewrites)");

  // keep awake (Render's free plan sleeps after 15 idle minutes): the server asks its own public address for /api/health
  // now and then - only where RENDER_EXTERNAL_URL / KEEP_AWAKE_URL is set, never with KEEP_AWAKE=0
  {
    const http = require("http"), hits = [];
    const srv = http.createServer((q, r) => { hits.push(q.url); r.end("{}"); });
    const port = await new Promise(r => srv.listen(0, () => r(srv.address().port)));
    const env = { ...process.env };
    delete process.env.KEEP_AWAKE_URL; delete process.env.RENDER_EXTERNAL_URL; delete process.env.KEEP_AWAKE;
    assert.strictEqual(keepAwake(() => {}, 20), null, "no public address: nothing");
    process.env.RENDER_EXTERNAL_URL = "http://127.0.0.1:" + port + "/";
    process.env.KEEP_AWAKE = "0";
    assert.strictEqual(keepAwake(() => {}, 20), null, "KEEP_AWAKE=0: off");
    delete process.env.KEEP_AWAKE;
    const said = [], t = keepAwake(m => said.push(m), 20);
    await new Promise(r => setTimeout(r, 120));
    clearInterval(t); srv.close();
    Object.keys(process.env).forEach(k => { if (!(k in env)) delete process.env[k]; }); Object.assign(process.env, env);
    assert(t && hits.length >= 2 && hits.every(u => u === "/api/health") && /keep awake: http:\/\/127\.0\.0\.1:\d+\/api\/health/.test(said[0]),
      "RENDER_EXTERNAL_URL: its /api/health asked again and again (" + hits.length + " times; " + said[0] + ")");
  }
  ok("keep awake: the server's own public address asked now and then (Render), off without one or with KEEP_AWAKE=0");

  // TRUST_PROXY: the client's address behind proxies - the last X-Forwarded-For entry, the n-th from the right, or a
  // header the edge proxy sets; /api/health says what the limits see (you) and, with ?addr=1, the forwarding headers
  {
    const { createServer } = require("../server.js");
    const seen = async (trustProxy, headers) => {
      const s = createServer({ quiet: true, trustProxy });
      const port = await new Promise(r => s.listen(0, r));
      const j = await (await fetch("http://127.0.0.1:" + port + "/api/health?addr=1", { headers })).json();
      await new Promise(r => s.close(r));
      return j;
    };
    const chain = { "x-forwarded-for": "6.6.6.6, 78.45.115.205, 10.199.247.25", "true-client-ip": "78.45.115.205" };
    assert.strictEqual((await seen("", chain)).you.replace(/^::ffff:/, ""), "127.0.0.1", "no TRUST_PROXY: the socket's peer");
    assert.strictEqual((await seen("1", chain)).you, "10.199.247.25", "1: the last entry");
    assert.strictEqual((await seen("2", chain)).you, "78.45.115.205", "2: the second from the right (a client's own entry before it doesn't count)");
    assert.strictEqual((await seen("true-client-ip", chain)).you, "78.45.115.205", "a header name: that header");
    assert.strictEqual((await seen("true-client-ip", { "x-forwarded-for": "1.2.3.4" })).you.replace(/^::ffff:/, ""), "127.0.0.1", "the header missing: the socket's peer");
    const d = await seen("2", chain);
    assert(d.fwd && d.fwd["x-forwarded-for"] === chain["x-forwarded-for"] && d.fwd["true-client-ip"], "?addr=1: the forwarding headers shown to the caller");
  }
  ok("TRUST_PROXY: last entry, n-th from the right, an edge proxy's header; /api/health's you and ?addr=1");

  console.log(`update-check: ${n} ok`);
})().catch(e => { console.error(e); process.exit(1); });
