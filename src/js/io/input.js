// Browser keyboard -> PC keyboard. Tracks held keys as PC scan codes (Kbd.KeyDown) and queues
// keystrokes as [ascii, scan] pairs for the BIOS keyboard buffer (menus, "press any key").

// KeyboardEvent.code -> set-1 scan code. Function keys are deliberately not mapped: the menus use the
// arrow keys + Enter (or the mouse), sound is toggled with M.
import { Controls } from "./controls.js";
const root = globalThis;

const SCAN = {
  Escape: 0x01, Digit1: 0x02, Digit2: 0x03, Digit3: 0x04, Digit4: 0x05, Digit5: 0x06, Digit6: 0x07, Digit7: 0x08,
  Digit8: 0x09, Digit9: 0x0A, Digit0: 0x0B, Minus: 0x0C, Equal: 0x0D, Backspace: 0x0E, Tab: 0x0F,
  KeyQ: 0x10, KeyW: 0x11, KeyE: 0x12, KeyR: 0x13, KeyT: 0x14, KeyY: 0x15, KeyU: 0x16, KeyI: 0x17, KeyO: 0x18, KeyP: 0x19,
  BracketLeft: 0x1A, BracketRight: 0x1B, Enter: 0x1C, ControlLeft: 0x1D,
  KeyA: 0x1E, KeyS: 0x1F, KeyD: 0x20, KeyF: 0x21, KeyG: 0x22, KeyH: 0x23, KeyJ: 0x24, KeyK: 0x25, KeyL: 0x26,
  Semicolon: 0x27, Quote: 0x28, Backquote: 0x29, ShiftLeft: 0x2A, Backslash: 0x2B,
  KeyZ: 0x2C, KeyX: 0x2D, KeyC: 0x2E, KeyV: 0x2F, KeyB: 0x30, KeyN: 0x31, KeyM: 0x32, Comma: 0x33, Period: 0x34, Slash: 0x35,
  ShiftRight: 0x36, NumpadMultiply: 0x37, AltLeft: 0x38, Space: 0x39, CapsLock: 0x3A,
  NumLock: 0x45, ScrollLock: 0x46, Numpad7: 0x47, Numpad8: 0x48, Numpad9: 0x49, NumpadSubtract: 0x4A,
  Numpad4: 0x4B, Numpad5: 0x4C, Numpad6: 0x4D, NumpadAdd: 0x4E, Numpad1: 0x4F, Numpad2: 0x50, Numpad3: 0x51,
  Numpad0: 0x52, NumpadDecimal: 0x53,
  // extended (E0-prefixed) keys report the same low scan code to the INT 9 handler
  NumpadEnter: 0x1C, ControlRight: 0x1D, AltRight: 0x38, Home: 0x47, ArrowUp: 0x48, PageUp: 0x49,
  ArrowLeft: 0x4B, ArrowRight: 0x4D, End: 0x4F, ArrowDown: 0x50, PageDown: 0x51, Insert: 0x52, Delete: 0x53,
};

// Browser-friendly changes to the held keys (Kbd.KeyDown) come from controls.js (Controls.scanOf): Blue moves
// with W A S D (S drives the original's "down" key, X scan 0x2D; X itself does nothing), neither Ctrl fires
// (Ctrl+W closes the browser tab), BLUE fires with Left Shift / Space, GREEN with Enter / Right Shift (Tab: the
// statistics, ui/livestats.js) -
// or the keys remapped in Settings.

const NAMED_ASCII = { Enter: 13, NumpadEnter: 13, Escape: 27, Backspace: 8, Tab: 9, Space: 32 };

class Keyboard {
  constructor(target, opts = {}) {
    this.down = new Map();              // code -> scan
    this.keys = [];                     // queued keystrokes [ascii, scan]
    this.aliases = opts.aliases !== false;
    this.onKey = null;                  // optional (code, event) hook, return true to swallow
    target.addEventListener("keydown", e => this.keydown(e));
    target.addEventListener("keyup", e => this.keyup(e));
    root.addEventListener("blur", () => this.down.clear());
  }

  keydown(e) {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const scan = SCAN[e.code];
    if (scan === undefined) return;
    if (this.onKey && this.onKey(e.code, e)) { e.preventDefault(); return; }
    e.preventDefault();
    const held = !this.aliases ? scan : Controls.scanOf(e.code, scan);
    if (held !== null) this.down.set(e.code, held);
    let ascii = NAMED_ASCII[e.code];
    if (ascii === undefined) ascii = e.key.length === 1 && e.key.charCodeAt(0) < 128 && !e.ctrlKey && !e.altKey ? e.key.charCodeAt(0) : 0;
    this.keys.push([ascii, scan, e.repeat]);           // [2]: auto-repeat of a held key
    if (this.keys.length > 32) this.keys.shift();
  }

  keyup(e) {
    if (this.down.has(e.code)) { this.down.delete(e.code); e.preventDefault(); }
  }

  // Kbd.KeyDown[0..127]
  keyDown() {
    const kd = new Uint8Array(128);
    for (const s of this.down.values()) kd[s & 127] = 1;
    return kd;
  }
  isDown(code) { return this.down.has(code); }
  takeKeys() { const k = this.keys; this.keys = []; return k; }
}

export { Keyboard, SCAN };
