package com.kaniansky.Tunneler

import android.content.ContentUris
import android.content.ContentValues
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.view.KeyEvent
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.ActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.google.android.gms.games.PlayGames
import com.google.android.gms.games.PlayGamesSdk
import com.google.android.play.core.appupdate.AppUpdateInfo
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.InstallStateUpdatedListener
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability
import org.json.JSONObject

// TUNNELER on Android (docs/ANDROID.md):
// - Google Play Games sign-in (docs/v6/ACCOUNTS.md 6): window.TunnelerAndroid.playGamesCode() signs in and asks for a
//   server auth code, answered by window.tunnelerPlayGames({code} | {error: "cancel" | "google"}); playGamesAvailable()
//   is false when the build has no Play Games project (PLAY_GAMES_APP_ID / PLAY_GAMES_WEB_CLIENT_ID at build time);
// - the game full screen (immersive: the status and navigation bars hidden, a swipe from the edge shows
//   them for a moment) and the screen kept on while the app is in front (a match is played with the touch
//   controls or a gamepad, often without touching the screen for a while);
// - the Back button / gesture is the game's Esc key ("Esc goes back everywhere": a menu's previous screen,
//   leaving a game), not the web view's history (most screens are no history entry: Back closed the app
//   from the Settings screen). On the main menu Back closes the app: the page tells it with
//   window.tunnelerBackExits() (true = on the main menu); without that function Back is always Esc;
// - window.TunnelerAndroid.saveFile(name, base64): a file (a replay) into the phone's Downloads folder - a page's
//   download (a blob link) does nothing in this web view (src/js/replays.js);
// - Google Play's in-app updates (only when Google Play installed the app): a newer major.minor (versionCode / 1000:
//   it can't play online with the old one) = Play's full-screen update, the app closes when it is cancelled; a newer
//   patch = Play's update dialog, once per version, downloaded while the game goes on and installed when the app
//   goes to the background from the main menu (or at the next start).
class MainActivity : TauriActivity() {
  override val handleBackNavigation: Boolean = false     // (WryActivity's own Back = history back: off)
  private var webView: WebView? = null
  private var backAdded = false

  // (the build's Play Games project: empty strings = no Google Play sign-in in this build)
  private val playGamesOn by lazy { getString(R.string.game_services_project_id).isNotEmpty() && getString(R.string.play_games_web_client).isNotEmpty() }

  // (Google Play installed the app: the in-app updates work only then - not for the APK channel nor a debug build)
  private val fromPlay by lazy {
    try {
      val installer = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) packageManager.getInstallSourceInfo(packageName).installingPackageName
        else @Suppress("DEPRECATION") packageManager.getInstallerPackageName(packageName)
      installer == "com.android.vending"
    } catch (e: Exception) { false }
  }
  private val updates by lazy { AppUpdateManagerFactory.create(this) }
  private var flexibleDownloaded = false
  private val updateFlow = registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { r: ActivityResult ->
    // the full-screen update cancelled (Back on Play's screen): the old version can't play online - closed
    if (r.resultCode == RESULT_CANCELED && immediateAsked) finish()
    immediateAsked = false
  }
  private var immediateAsked = false
  private val installListener = InstallStateUpdatedListener { state ->
    if (state.installStatus() == InstallStatus.DOWNLOADED) flexibleDownloaded = true
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    if (playGamesOn) PlayGamesSdk.initialize(this)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    immersive()
    if (fromPlay) checkUpdate(true)
  }

  private var resumed = false
  override fun onResume() {
    super.onResume()
    if (resumed && fromPlay) checkUpdate(false)
    resumed = true
  }

  // the patch downloaded while the game ran: installed when the app leaves from the main menu (Play installs it
  // silently in the background and the app restarts), never during a match - else at the next start
  override fun onStop() {
    super.onStop()
    if (flexibleDownloaded) onMainMenu { if (it && flexibleDownloaded) { flexibleDownloaded = false; updates.completeUpdate() } }
  }

  override fun onDestroy() {
    if (fromPlay) updates.unregisterListener(installListener)
    super.onDestroy()
  }

  // start: a newer version asks (above); back in front: a full-screen update left unfinished goes on (Play's rule)
  private fun checkUpdate(start: Boolean) {
    updates.appUpdateInfo.addOnSuccessListener { info ->
      val immediate = info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS
      if (immediate) return@addOnSuccessListener startUpdate(info, AppUpdateType.IMMEDIATE)
      if (!start) return@addOnSuccessListener
      // a patch downloaded on an earlier run and not installed yet: installed now, at the start (nothing to lose)
      if (info.installStatus() == InstallStatus.DOWNLOADED) { updates.completeUpdate(); return@addOnSuccessListener }
      if (info.updateAvailability() != UpdateAvailability.UPDATE_AVAILABLE) return@addOnSuccessListener
      val newer = info.availableVersionCode()
      if (newer / 1000 > BuildConfig.VERSION_CODE / 1000 && info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE))
        startUpdate(info, AppUpdateType.IMMEDIATE)
      else if (info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)) {
        val prefs = getSharedPreferences("updates", MODE_PRIVATE)
        if (prefs.getInt("asked", 0) == newer) return@addOnSuccessListener
        prefs.edit().putInt("asked", newer).apply()
        updates.registerListener(installListener)
        startUpdate(info, AppUpdateType.FLEXIBLE)
      }
    }.addOnFailureListener { e -> Log.w("TunnelerUpdate", "no update info", e) }
  }

  private fun startUpdate(info: AppUpdateInfo, type: Int) {
    try {
      immediateAsked = type == AppUpdateType.IMMEDIATE
      updates.startUpdateFlowForResult(info, updateFlow, AppUpdateOptions.newBuilder(type).build())
    } catch (e: Exception) {
      immediateAsked = false
      Log.w("TunnelerUpdate", "update flow", e)
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    webView.addJavascriptInterface(Files(), "TunnelerAndroid")
  }

  // the page's own files to the user's: returns where the file went ("Download/<name>"), "" when it couldn't
  inner class Files {
    @JavascriptInterface
    fun playGamesAvailable(): Boolean = playGamesOn

    @JavascriptInterface
    fun playGamesCode() { runOnUiThread { playGamesSignIn() } }

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

  // Back: added once the app is up. Tauri's own app plugin adds a handler too (history back while the web view has
  // history, else the next handler) - the handler added last is asked first, and which one that is is a race (the
  // plugin can come after onPostResume). The pages keep no history in this app (app.js noHistory), so Tauri's handler
  // always passes Back on to this one
  // signed in already (Play Games signs in by itself at start), else the sign-in dialog; then the server auth code
  // (a failure logged as TunnelerPlayGames; Google's own reason: tag PlayGamesServices[SignInAuthenticator] - ACCOUNTS.md 6)
  private fun playGamesSignIn() {
    if (!playGamesOn) return playGamesAnswer(null, "google")
    val client = PlayGames.getGamesSignInClient(this)
    client.isAuthenticated.addOnCompleteListener { t ->
      if (t.isSuccessful && t.result.isAuthenticated) playGamesServerCode()
      else client.signIn().addOnCompleteListener { s ->
        if (s.isSuccessful && s.result.isAuthenticated) playGamesServerCode()
        else { Log.w("TunnelerPlayGames", "sign-in: not signed in", s.exception); playGamesAnswer(null, "cancel") }
      }
    }
  }
  private fun playGamesServerCode() {
    PlayGames.getGamesSignInClient(this).requestServerSideAccess(getString(R.string.play_games_web_client), false)
      .addOnCompleteListener { t ->
        if (t.isSuccessful && !t.result.isNullOrEmpty()) playGamesAnswer(t.result, null)
        else { Log.w("TunnelerPlayGames", "server auth code refused", t.exception); playGamesAnswer(null, "google") }
      }
  }
  private fun playGamesAnswer(code: String?, error: String?) {
    val js = if (code != null) "{\"code\":" + JSONObject.quote(code) + "}" else "{\"error\":" + JSONObject.quote(error ?: "google") + "}"
    webView?.post { webView?.evaluateJavascript("window.tunnelerPlayGames && window.tunnelerPlayGames($js)", null) }
  }

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
    onMainMenu { menu ->
      if (menu) moveTaskToBack(true)
      else {
        wv.dispatchKeyEvent(esc(KeyEvent.ACTION_DOWN))
        wv.dispatchKeyEvent(esc(KeyEvent.ACTION_UP))
      }
    }
  }

  // the page shows the main menu (window.tunnelerBackExits(): true there)
  private fun onMainMenu(answer: (Boolean) -> Unit) {
    val wv = webView ?: return answer(false)
    wv.evaluateJavascript("(function(){try{return !!(window.tunnelerBackExits&&window.tunnelerBackExits())}catch(e){return false}})()") { r ->
      answer(r == "true")
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
