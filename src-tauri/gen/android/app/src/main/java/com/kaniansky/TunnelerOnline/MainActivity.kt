package com.kaniansky.TunnelerOnline

import android.os.Bundle
import android.view.KeyEvent
import android.view.WindowManager
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

// TUNNELER ONLINE on Android (docs/ANDROID.md):
// - the game full screen (immersive: the status and navigation bars hidden, a swipe from the edge shows
//   them for a moment) and the screen kept on while the app is in front (a match is played with the touch
//   controls or a gamepad, often without touching the screen for a while);
// - the Back button / gesture is the game's Esc key ("Esc goes back everywhere": a menu's previous screen,
//   leaving a game), not the web view's history (most screens are no history entry: Back closed the app
//   from the Settings screen). On the main menu Back closes the app: the page tells it with
//   window.tunnelerBackExits() (true = on the main menu); without that function Back is always Esc.
class MainActivity : TauriActivity() {
  override val handleBackNavigation: Boolean = false     // (WryActivity's own Back = history back: off)
  private var webView: WebView? = null
  private var backAdded = false

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    immersive()
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
  }

  // Back: added once the app is up, after Tauri's own app plugin added its handler (history back) - the
  // handler added last is asked first
  override fun onPostResume() {
    super.onPostResume()
    if (backAdded) return
    backAdded = true
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() = back()
    })
  }

  private fun back() {
    val wv = webView
    if (wv == null) { moveTaskToBack(true); return }
    wv.evaluateJavascript("(function(){try{return !!(window.tunnelerBackExits&&window.tunnelerBackExits())}catch(e){return false}})()") { r ->
      if (r == "true") moveTaskToBack(true)
      else {
        wv.dispatchKeyEvent(esc(KeyEvent.ACTION_DOWN))
        wv.dispatchKeyEvent(esc(KeyEvent.ACTION_UP))
      }
    }
  }

  // Esc as a keyboard sends it: with its scan code (1 = KEY_ESC), or the page's KeyboardEvent.code (what the
  // game reads) would be empty
  private fun esc(action: Int): KeyEvent {
    val t = android.os.SystemClock.uptimeMillis()
    return KeyEvent(t, t, action, KeyEvent.KEYCODE_ESCAPE, 0, 0, android.view.KeyCharacterMap.VIRTUAL_KEYBOARD, 1, 0, android.view.InputDevice.SOURCE_KEYBOARD)
  }

  // (again whenever the app comes back: a dialog, the keyboard or another app may have shown the bars)
  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) immersive()
  }

  private fun immersive() {
    val controller = WindowCompat.getInsetsController(window, window.decorView)
    controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    controller.hide(WindowInsetsCompat.Type.systemBars())
  }
}
