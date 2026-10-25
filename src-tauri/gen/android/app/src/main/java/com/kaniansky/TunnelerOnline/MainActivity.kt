package com.kaniansky.TunnelerOnline

import android.content.ContentUris
import android.content.ContentValues
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.view.KeyEvent
import android.view.WindowManager
import android.webkit.JavascriptInterface
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
//   window.tunnelerBackExits() (true = on the main menu); without that function Back is always Esc;
// - window.TunnelerAndroid.saveFile(name, base64): a file (a replay) into the phone's Downloads folder - a page's
//   download (a blob link) does nothing in this web view (src/js/replays.js).
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
    webView.addJavascriptInterface(Files(), "TunnelerAndroid")
  }

  // the page's own files to the user's: returns where the file went ("Download/<name>"), "" when it couldn't
  inner class Files {
    @JavascriptInterface
    fun saveFile(name: String, base64: String): String {
      val safe = name.replace(Regex("[^A-Za-z0-9._-]"), "_").take(80).ifEmpty { "tunneler.replay" }
      return try {
        val bytes = Base64.decode(base64, Base64.DEFAULT)
        if (bytes.size > 20_000_000) return ""
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          // (Android 10+: MediaStore, no permission needed; a file of that name this app saved before is written
          // over - MediaStore would add another one, "name (1)")
          val downloads = MediaStore.Downloads.EXTERNAL_CONTENT_URI
          var uri: android.net.Uri? = null
          contentResolver.query(downloads, arrayOf(MediaStore.MediaColumns._ID),
            MediaStore.MediaColumns.DISPLAY_NAME + "=? AND " + MediaStore.MediaColumns.RELATIVE_PATH + "=?",
            arrayOf(safe, Environment.DIRECTORY_DOWNLOADS + "/"), null)?.use { c ->
            if (c.moveToFirst()) uri = ContentUris.withAppendedId(downloads, c.getLong(0))
          }
          val target = uri ?: contentResolver.insert(downloads, ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, safe)
            put(MediaStore.MediaColumns.MIME_TYPE, "application/octet-stream")
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
          }) ?: return ""
          contentResolver.openOutputStream(target, "wt")?.use { it.write(bytes) } ?: return ""
          if (uri == null) contentResolver.update(target, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
          Environment.DIRECTORY_DOWNLOADS + "/" + safe
        } else {
          // (Android 7 - 9: the public Downloads folder needs a permission there - the app's own one)
          val dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: return ""
          val f = java.io.File(dir, safe)
          f.writeBytes(bytes)
          f.absolutePath
        }
      } catch (e: Exception) {
        ""
      }
    }
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
