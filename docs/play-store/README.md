# Google Play - what to upload where

Everything for the Play Store listing of the Android app (`com.kaniansky.Tunneler`, version 1.0.0).
Background: docs/ANDROID.md (build, signing, CI). Files in this folder:

| File | What |
|---|---|
| `listing.md` | App name, short and full description in en, sk, cs, uk, ru (with character counts) |
| `forms.md` | Suggested answers: Data safety, content rating, target audience, ads, app access, category, contact |
| `icon-512.png` | The app icon, 512 x 512, full square (Play rounds the corners itself) - `node tools/make-icons.js` |
| `feature-graphic.png` | 1024 x 500 feature graphic |
| `screenshots/phone-1..8-*.png` | Phone screenshots, upright, 1080 x 2160 (1:2 - Play allows at most 2:1) |
| `screenshots/tablet7-1..8-*.png` | 7" tablet screenshots, sideways, 1920 x 1200 |
| `screenshots/tablet10-1..8-*.png` | 10" tablet screenshots, sideways, 2560 x 1600 |

`node tools/play-screenshots.js` takes all of them from the current build (`npm run build` first; it runs its own
server, modern graphics, a touch device): 1 the main menu, 2 the skirmish's settings, 3 a battle with the touch
controls, 4 four tanks, 5 an online game's lobby (quick play), 6 the daily challenge's leaderboard, 7 the map
editor, 8 a replay.

## Before you start

- [x] Google Play developer account (one-time fee, identity verification) - verified 2026-10-26. A **new personal account** must
      run a **closed test** before it can publish to production (currently at least 12 testers opted in
      for 14 days in a row - check the current rule in Play Console).
- [x] The privacy policy page is **online**: `https://kaniansky.com/tunneler/privacy.html`. `site/privacy.html`
      is uploaded with the rest of `site/` by release.yml's `site` job at the next release - or upload that
      one file by hand (FTPS, `web/tunneler/privacy.html`) before submitting.
- [ ] The release's AAB is **signed**: the GitHub release v1.0.0 must have
      `tunneler-1.0.0-android.aab` (not `...-android-unsigned.aab`; unsigned means the
      `ANDROID_KEYSTORE` secret was missing when CI ran).

## Play Console checklist

1. **Create app**: name "Tunneler", default language English (United States), **Game**, **Free**,
   accept the declarations.
2. **Testing -> Internal testing** (first release goes here, not to production):
   - Create a release, **Play App Signing**: keep Google's default (Google holds the app signing key; the
     key that signs the AAB in CI becomes the **upload key**).
   - Upload `tunneler-1.0.0-android.aab` from the GitHub release v1.0.0.
   - Release name `1.0.0`; release notes: a few lines from CHANGELOG.md's 1.0.0 section.
   - Add yourself (and testers) by e-mail list; install from the opt-in link and play once (menus, a
     skirmish, an online game, saving a replay).
   - Then a **closed test** (required for new personal accounts), then **production**.
3. **Main store listing** (Grow users -> Store presence -> Main store listing):
   - App name, short description, full description: `listing.md` -> en.
   - App icon: `icon-512.png`.
   - Feature graphic: `feature-graphic.png`.
   - Phone screenshots: `screenshots/phone-1-menu.png` ... `phone-8-replay.png` (2-8 allowed; order as numbered).
   - 7-inch / 10-inch tablet screenshots: `screenshots/tablet7-*.png` / `tablet10-*.png`.
   - Translations: "Manage translations" -> "Add your own translations" -> sk-SK, cs-CZ, uk-UA, ru-RU,
     paste from `listing.md` (the same graphics are used unless you upload localized ones).
4. **Store settings**: category Game -> **Arcade** (or Action), tags, contact e-mail and website
   (`forms.md`).
5. **App content** (Policy and programs -> App content), from `forms.md`:
   - Privacy policy URL: `https://kaniansky.com/tunneler/privacy.html`
   - Ads: no
   - App access: all functionality available without special access
   - Content rating: IARC questionnaire (category Game; violence: yes, non-realistic, vehicles; users
     interact: yes)
   - Target audience: 13+
   - Data safety: Name, Other in-app messages, App interactions, Device or other IDs - collected, optional,
     app functionality, not shared, encrypted in transit
   - News / government / financial / health / COVID: no
6. **Countries / regions** for each track; then send the release for review.

## Notes

### Play App Signing and the upload key

- With Play App Signing (the default) Google re-signs the app for users with its own app signing key. What
  you upload must be signed with the **upload key**: the keystore in the repository secret
  `ANDROID_KEYSTORE` (base64 of `~/.tauri/android-upload.jks`, alias `ANDROID_KEY_ALIAS`, see
  docs/ANDROID.md "Signing" / "Releases (CI)"). Play remembers the first upload's certificate - every later
  AAB must be signed with the same key. Keep the keystore and its passwords backed up.
- If the upload key is ever lost or leaked, Play Console -> Setup -> App signing -> "Request upload key
  reset" (Google checks it; takes a few days). The app signing key itself is never with you.
- The APK attached to GitHub releases is signed with the upload key, not Google's app signing key, so a
  user cannot update a GitHub-APK install from Play (or the other way round) without uninstalling first -
  different certificates. Worth a line on the homepage once the Play version is out.

### Native debug symbols

- The AAB carries the Rust library's symbol table (`ndk { debugSymbolLevel = "SYMBOL_TABLE" }` in
  `app/build.gradle.kts`, the library built unstripped in CI), so Play Console shows readable native crash stacks
  and no "no debug symbols" warning. The APKs stay stripped.

### versionCode

- Nothing in the repository sets a versionCode by hand. `src-tauri/tauri.conf.json` takes the version from
  `package.json` (`"version": "../package.json"`), and the Tauri CLI computes
  **versionCode = major * 1000000 + minor * 1000 + patch** (1.0.0 -> **1000000**) and writes it into
  `src-tauri/gen/android/app/tauri.properties` (generated at build time, gitignored), which
  `app/build.gradle.kts` reads (`tauri.android.versionCode`).
- So every release with a new version number (`vX.Y.Z` tag -> CI builds the AAB) gets a higher versionCode
  automatically: 1.0.1 -> 1000001, 1.1.0 -> 1001000, 2.0.0 -> 2000000.
- Play refuses an upload whose versionCode it has seen before, also on another track. To re-upload a
  rebuilt 1.0.0 (e.g. after a signing fix) you need a new version (1.0.1), or an explicit
  `bundle.android.versionCode` in `src-tauri/tauri.android.conf.json` - not set today.
- The scheme breaks only if minor or patch ever reach 1000.

### Each later release

1. Tag `vX.Y.Z` as usual -> CI attaches `tunneler-X.Y.Z-android.aab`.
2. Play Console -> the track -> Create new release -> upload the AAB, release notes from CHANGELOG.md.
3. Update the Data safety form if what the app sends changed (`forms.md`), and the screenshots / texts if the game looks different.
4. Google requires a recent target SDK every year (the generated project targets API 37).
