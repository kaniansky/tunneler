// The account screens (docs/v6/ACCOUNTS.md) in the DOS look, drawn on any DosUI - the homepage's, the games list's,
// the online game's overlay, the daily challenge's:
//   Login.ask(ui, {done, back, backKey})   LOG IN -> (CREATE AN ACCOUNT -> YOUR RECOVERY CODE) / (RESET PASSWORD ->
//                                          YOUR RECOVERY CODE); done(session) once logged in, back() on Back / <ESC>
//   Login.change(ui, {done, back})         CHANGE PASSWORD (the session's account)
//   Login.remove(ui, {done, back})         DELETE ACCOUNT (its password; the item asks twice)
// Inputs: DosUI's (keyboard, paste, the phone's keyboard through the hidden soft input - type=password for secret
// ones); Enter on an input goes on to the next one, on the last one does the screen's action.
import { Account } from "./account.js";
import { Lang } from "./lang.js";
import { NetProto } from "./netproto.js";
import { UniText } from "./unitext.js";

const T = (k, p) => Lang.t(k, p);
const PW_MAX = NetProto.MAX_ACCOUNT_PASSWORD;
// the refusal in words (font text)
// (wrong: what was wrong - ctx "wrongcode" for a reset, "wrongpw" for a password check)
function errText(r, ctx) {
  const c = r && r.code;
  if (c === "wrong" && ctx) return T("acc.err." + ctx);
  if (c === "locked") return T("acc.err.locked", { n: String(Math.max(1, r.wait | 0 || 60)) });
  if (c === "net") return T("acc.err.net");
  if (["wrong", "busy", "taken", "name", "short", "long", "off", "session", "match", "empty", "code", "storage", "google", "linked", "cancel"].includes(c)) return T("acc.err." + c);
  return T("acc.err.server", { msg: String(r && (r.msg || c) || "?").slice(0, 40) });
}
// right-aligned labels: the inputs line up (display columns)
function labels(keys) {
  const raw = keys.map(k => Lang.raw(k) || ""), w = Math.max(...raw.map(r => UniText.cols(r)));
  return raw.map(r => " ".repeat(w - UniText.cols(r)) + Lang.enc(r));
}
// an input's width: as wide as its longest placeholder in any language (at least min), at most max columns
const widthFor = (ph, min, max) => Math.min(max, Math.max(min, ...Lang.codes.map(c => UniText.cols(Lang.raw(ph, c) || ""))));

// a form screen: title, the server, the lines, the fields, the action, more items, Back; err / busy: a line under the text
function formScreen(ui, f, keep) {
  const lines = [{ row: 2, text: T(f.title), color: 12 }, { row: 4, text: T("acc.server", { host: Account.host() }), color: 7 }];
  f.lines.forEach((t, i) => lines.push({ row: 6 + i, text: typeof t === "string" ? T(t) : t.text, color: typeof t === "string" ? 3 : t.color }));
  const top = 6 + f.lines.length;
  if (f.state.busy) lines.push({ row: top, text: T("acc.wait"), color: 14 });
  else if (f.state.err) lines.push({ row: top, text: f.state.err, color: 12 });
  const L = labels(f.fields.map(x => x.label));
  const items = f.fields.map((x, i) => ({ key: x.key, label: L[i], input: x.input, align: "left", info: x.info.map(k => T(k)),
    go: i < f.fields.length - 1 ? () => ui.move(1) : f.go.run }));
  items.push({ key: "gap", label: "", disabled: true }, { key: "go", label: T(f.go.label), info: f.go.info.map(k => T(k)), go: f.go.run });
  for (const x of f.extra || []) items.push(x);
  items.push({ key: "gap2", label: "", disabled: true }, { key: "back", label: T(f.back.label), info: [T(f.back.label + ".i")], go: f.back.run });
  const y = top + 2;
  ui.show({ lines, box: { y }, infoRow: Math.min(21, y + items.length + 3), back: f.back.run, items }, keep);
}

// YOUR RECOVERY CODE: shown once (after creating an account, after a reset)
// text onto the clipboard: the Clipboard API, else a hidden text area and the old copy command (web views without
// the API) -> true when it worked
async function copyText(text) {
  try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; } } catch (e) { /* the fallback */ }
  try {
    const d = document, ta = d.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); Object.assign(ta.style, { position: "fixed", left: "-9999px", top: "0" });
    d.body.appendChild(ta); ta.select();
    const ok = d.execCommand && d.execCommand("copy");
    ta.remove();
    return !!ok;
  } catch (e) { return false; }
}

function showCode(ui, name, code, isReset, done, note) {
  // Copy the code (owner, 2026-10-25): onto the clipboard - said in green, or in red to write it down
  const copy = async () => {
    const ok = await copyText(code);
    showCode(ui, name, code, isReset, done, ok ? { text: T("acc.code.copied"), color: 10 } : { text: T("acc.code.nocopy"), color: 12 });
  };
  ui.show({
    lines: [{ row: 2, text: T("acc.code.title"), color: 12 },
      { row: 4, text: isReset ? T("acc.code.new", { name }) : T("acc.code.hi", { name }), color: 15 },
      { row: 6, text: T("acc.code.i1"), color: 3 },
      { row: 8, text: Lang.enc(code), color: 14 },
      { row: 10, text: T("acc.code.i2"), color: 15 },
      { row: 11, text: T("acc.code.i3"), color: 12 }],
    box: { y: 14 }, infoRow: 18, back: done,
    items: [{ key: "copy", label: T("acc.code.copy"), info: [note || T("acc.code.copy.i")], go: copy },
      { key: "ok", label: T("acc.code.ok"), info: [T("acc.code.ok.i")], go: done }],
  }, !!note);
}

function ask(ui, opts) {
  const done = opts.done, backKey = opts.backKey || "back.main";
  const state = { err: null, busy: false };
  let view = "login";
  const user = { value: Account.name() || "", max: NetProto.MAX_PLAYER_NAME, width: widthFor("ph.user", NetProto.MAX_PLAYER_NAME, 18) };
  const pass = { value: "", max: PW_MAX, width: 20, secret: true }, pass2 = { value: "", max: PW_MAX, width: 20, secret: true };
  const code = { value: "", max: 23, width: 23 };
  let link = null;                                       // (Google Play, the first time: the server's link for the username)
  const clear = () => { pass.value = ""; pass2.value = ""; code.value = ""; state.err = null; };
  const to = v => { view = v; clear(); ui.sel = 0; draw(); };
  const back = () => { if (state.busy) return; if (view === "login") opts.back(); else to("login"); };
  // a request: busy meanwhile (keys do nothing), then the answer
  async function run(req, ok, ctx) {
    if (state.busy) return;
    state.busy = true; state.err = null; draw(true);
    let r;
    try { r = await req(); } catch (e) { r = { ok: false, code: "net" }; }
    state.busy = false;
    if (r.ok) return ok(r);
    state.err = errText(r, ctx);
    draw(true);
  }
  const refuse = c => { state.err = errText({ code: c }); draw(true); };
  function doLogin() {
    if (!user.value.trim() || !pass.value) return refuse("empty");
    run(() => Account.login(user.value, pass.value), () => { clear(); done(Account.session()); });
  }
  function doCreate() {
    const name = NetProto.cleanUsername(user.value);
    if (!name) return refuse("name");
    const pp = NetProto.passwordProblem(pass.value);
    if (pp) return refuse(pp);
    if (pass.value !== pass2.value) return refuse("match");
    run(() => Account.signup(name, pass.value), r => { clear(); view = "code"; showCode(ui, r.account.name, r.recovery, false, () => done(Account.session())); });
  }
  // Google Play (the Android app): signed in - or, the first time, CHOOSE A USERNAME (Google Play's name suggested)
  function doGoogle() {
    run(() => Account.googleSignIn(), r => {
      if (r.token) { clear(); return done(Account.session()); }
      link = r.link; to("gname"); if (r.suggest && !user.value.trim()) user.value = r.suggest; draw(true);
    });
  }
  function doGoogleName() {
    const name = NetProto.cleanUsername(user.value);
    if (!name) return refuse("name");
    run(() => Account.googleSignup(link, name), () => { clear(); link = null; done(Account.session()); });
  }
  function doReset() {
    if (!user.value.trim() || !NetProto.cleanRecovery(code.value)) return refuse("code");
    const pp = NetProto.passwordProblem(pass.value);
    if (pp) return refuse(pp);
    if (pass.value !== pass2.value) return refuse("match");
    run(() => Account.reset(user.value, code.value, pass.value), r => { clear(); view = "code"; showCode(ui, r.account.name, r.recovery, true, () => done(Account.session())); }, "wrongcode");
  }
  function draw(keep) {
    user.placeholder = T("ph.user"); code.placeholder = T("ph.code");
    pass.placeholder = view === "login" ? "" : T("ph.pass8"); pass2.placeholder = "";
    const backItem = { label: view === "login" ? backKey : "acc.back", run: back };
    if (view === "login") formScreen(ui, { title: "acc.login.title", lines: ["acc.login.i1", "acc.login.i2"], state,
      fields: [{ key: "user", label: "acc.user", input: user, info: ["acc.user.i"] }, { key: "pass", label: "acc.pass", input: pass, info: ["acc.login.go.i"] }],
      go: { label: "acc.login.go", info: ["acc.login.go.i"], run: doLogin },
      extra: [...(Account.google() ? [{ key: "gplay", label: T("acc.gplay"), info: [T("acc.gplay.i")], go: doGoogle }] : []),
        { key: "create", label: T("acc.create"), info: [T("acc.create.i")], go: () => { if (!state.busy) to("create"); } },
        { key: "forgot", label: T("acc.forgot"), info: [T("acc.forgot.i")], go: () => { if (!state.busy) to("reset"); } }],
      back: backItem }, keep);
    else if (view === "create") formScreen(ui, { title: "acc.create.title", lines: ["acc.create.i1", "acc.create.i2"], state,
      fields: [{ key: "user", label: "acc.user", input: user, info: ["acc.user.i"] }, { key: "pass", label: "acc.pass", input: pass, info: ["acc.pass.i"] },
        { key: "pass2", label: "acc.pass2", input: pass2, info: ["acc.pass.i"] }],
      go: { label: "acc.create.go", info: ["acc.create.go.i"], run: doCreate }, back: backItem }, keep);
    else if (view === "gname") formScreen(ui, { title: "acc.gname.title", lines: ["acc.gname.i1", "acc.gname.i2"], state,
      fields: [{ key: "user", label: "acc.user", input: user, info: ["acc.user.i"] }],
      go: { label: "acc.gname.go", info: ["acc.gname.go.i"], run: doGoogleName }, back: backItem }, keep);
    else if (view === "reset") formScreen(ui, { title: "acc.reset.title", lines: ["acc.reset.i1", "acc.reset.i2"], state,
      fields: [{ key: "user", label: "acc.user", input: user, info: ["acc.reset.user.i"] }, { key: "code", label: "acc.code", input: code, info: ["acc.code.i"] },
        { key: "pass", label: "acc.newpass", input: pass, info: ["acc.pass.i"] }, { key: "pass2", label: "acc.pass2", input: pass2, info: ["acc.pass.i"] }],
      go: { label: "acc.reset.go", info: ["acc.reset.go.i"], run: doReset }, back: backItem }, keep);
  }
  draw();
  return { view: () => view, state };
}

function change(ui, opts) {
  const state = { err: null, busy: false };
  const old = { value: "", max: PW_MAX, width: 20, secret: true }, pass = { value: "", max: PW_MAX, width: 20, secret: true }, pass2 = { value: "", max: PW_MAX, width: 20, secret: true };
  const back = () => { if (!state.busy) opts.back(); };
  const hasPw = Account.hasPassword();                   // (an account made with Google Play sets its first one: no old one)
  async function go() {
    if (state.busy) return;
    const pp = NetProto.passwordProblem(pass.value);
    if (hasPw && !old.value) { state.err = errText({ code: "empty" }); return draw(true); }
    if (pp || pass.value !== pass2.value) { state.err = errText({ code: pp || "match" }); return draw(true); }
    state.busy = true; state.err = null; draw(true);
    const r = await Account.changePassword(old.value, pass.value).catch(() => ({ ok: false, code: "net" }));
    state.busy = false;
    if (r.ok) return opts.done();
    state.err = errText(r, "wrongpw");
    if (r.code === "session") return opts.back();
    draw(true);
  }
  function draw(keep) {
    pass.placeholder = T("ph.pass8");
    formScreen(ui, { title: hasPw ? "acc.change.title" : "acc.setpw.title", lines: hasPw ? ["acc.change.i1", "acc.change.i2"] : ["acc.setpw.i1", "acc.change.i2"], state,
      fields: [...(hasPw ? [{ key: "old", label: "acc.oldpass", input: old, info: ["acc.change.i1"] }] : []), { key: "pass", label: "acc.newpass", input: pass, info: ["acc.pass.i"] },
        { key: "pass2", label: "acc.pass2", input: pass2, info: ["acc.pass.i"] }],
      go: { label: "acc.change.go", info: ["acc.change.go.i"], run: go }, back: { label: "set.back", run: back } }, keep);
  }
  draw();
}

function remove(ui, opts) {
  const state = { err: null, busy: false };
  const pass = { value: "", max: PW_MAX, width: 20, secret: true };
  let armed = 0, timer = null;
  const back = () => { if (!state.busy) { clearTimeout(timer); opts.back(); } };
  const hasPw = Account.hasPassword();                   // (without one - Google Play: Enter twice is all)
  async function go() {
    if (state.busy) return;
    if (hasPw && !pass.value) { state.err = errText({ code: "empty" }); return draw(true); }
    // (the first Enter arms it for 4 s - a second one deletes)
    if (!(armed > Date.now())) { armed = Date.now() + 4000; clearTimeout(timer); timer = setTimeout(() => { armed = 0; draw(true); }, 4000); return draw(true); }
    armed = 0; clearTimeout(timer);
    state.busy = true; state.err = null; draw(true);
    const r = await Account.remove(pass.value).catch(() => ({ ok: false, code: "net" }));
    state.busy = false;
    if (r.ok) return opts.done();
    state.err = errText(r, "wrongpw");
    if (r.code === "session") return opts.back();
    draw(true);
  }
  function draw(keep) {
    const name = Account.name();
    formScreen(ui, { title: "acc.delete.title", lines: [{ text: T("acc.delete.i1", { name }), color: 15 }, "acc.delete.i2", hasPw ? "acc.delete.i3" : "acc.delete.i3g"], state,
      fields: hasPw ? [{ key: "pass", label: "acc.pass", input: pass, info: ["acc.delete.i3"] }] : [],
      go: { label: "acc.delete.go", info: armed > Date.now() ? [] : ["acc.delete.go.i"], run: go }, back: { label: "set.back", run: back } }, keep);
    // (armed: the warning in red as the item's info)
    if (armed > Date.now() && ui.spec && ui.spec.items) {
      const it = ui.spec.items.find(x => x.key === "go");
      if (it) { it.info = [{ text: T("acc.delete.sure"), color: 12 }]; ui.draw(); }
    }
  }
  draw();
}

export const Login = { ask, change, remove, code: showCode, errText };
