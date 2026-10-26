import java.util.Properties
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// Release signing (docs/ANDROID.md): gen/android/keystore.properties (never committed: .gitignore) with
// storeFile (path to the .jks / .keystore, relative to gen/android or absolute), storePassword,
// keyAlias, keyPassword. Without the file the release APK / AAB stay unsigned.
val keystoreProperties = Properties().apply {
    val propFile = rootProject.file("keystore.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    if (keystoreProperties.getProperty("storeFile") != null) {
        signingConfigs {
            create("release") {
                storeFile = rootProject.file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }
    compileSdk = 37
    namespace = "com.kaniansky.Tunneler"
    defaultConfig {
        // plain http allowed: the Settings screen's Server may be a game server on the local network
        // (src/js/endpoint.js: "192.168.1.5:8050" -> http://...); the public server is https / wss
        manifestPlaceholders["usesCleartextTraffic"] = "true"
        applicationId = "com.kaniansky.Tunneler"
        minSdk = 24
        // Google Play Games sign-in (docs/v6/ACCOUNTS.md 6): the Play Games project's id and the game server's OAuth
        // (web) client id, from the build's environment (repository variables in CI) - empty: no Google Play sign-in
        resValue("string", "game_services_project_id", System.getenv("PLAY_GAMES_APP_ID") ?: "")
        resValue("string", "play_games_web_client", System.getenv("PLAY_GAMES_WEB_CLIENT_ID") ?: "")
        targetSdk = 37
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
        }
        getByName("release") {
            signingConfigs.findByName("release")?.let { signingConfig = it }
            optimization {
               enable = true
            }
            proguardFiles(
                *fileTree(".") {
                  include("**/*.pro")
                  exclude("build/**")
                }.files.toTypedArray()
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    buildFeatures {
        buildConfig = true
        // the Play Games ids above (AGP 9 has resource values off by default)
        resValues = true
    }
}

// debug builds keep their libraries' symbols (the Tauri template's packaging block did this inside
// getByName("debug"), but there it set android.packaging - every build type: 1.1.0's release APK was 38 MB)
androidComponents {
    onVariants(selector().withBuildType("debug")) { variant ->
        variant.packaging.jniLibs.keepDebugSymbols.addAll(listOf("*/arm64-v8a/*.so", "*/armeabi-v7a/*.so", "*/x86/*.so", "*/x86_64/*.so"))
    }
}

// Release builds: the Rust library comes unstripped (CI: CARGO_PROFILE_RELEASE_STRIP=false); before Gradle packs
// it, its copy with the symbols goes into build/outputs/native-debug-symbols/universalRelease/native-debug-symbols.zip
// (<abi>/<lib>.so - Play Console's "native debug symbols", uploaded with the AAB; never published) and the packed one
// is stripped with the NDK's llvm-strip (NDK_HOME). Gradle's own ndk.debugSymbolLevel didn't strip nor extract here.
val stripRustRelease = tasks.register("stripRustRelease") {
    dependsOn("rustBuildUniversalRelease")
    // (locals: doLast may hold no reference to the build script - the configuration cache)
    val ndkHome: String? = System.getenv("NDK_HOME")
    val jniLibsDir = file("src/main/jniLibs")
    val rustSymbolsDir = layout.buildDirectory.dir("intermediates/rust-symbols").get().asFile
    val rustSymbolsZip = layout.buildDirectory.file("outputs/native-debug-symbols/universalRelease/native-debug-symbols.zip").get().asFile
    doLast {
        val ndk = ndkHome ?: return@doLast
        val strip = File(ndk, "toolchains/llvm/prebuilt").listFiles()?.map { File(it, "bin/llvm-strip") }
            ?.firstOrNull { it.exists() } ?: throw GradleException("no llvm-strip in $ndk")
        rustSymbolsDir.deleteRecursively()
        jniLibsDir.walk().filter { it.name.endsWith(".so") }.forEach { lib ->
            // the jniLibs entry is a symlink into target/ (Tauri makes it again every build): keep target/'s file
            // unstripped, put a stripped file in the link's place
            val real = lib.canonicalFile
            real.copyTo(File(rustSymbolsDir, "${lib.parentFile.name}/${lib.name}"))
            val stripped = File(lib.parentFile, "${lib.name}.stripped")
            val code = ProcessBuilder(strip.path, "--strip-unneeded", "-o", stripped.path, real.path).inheritIO().start().waitFor()
            if (code != 0) throw GradleException("llvm-strip $real: exit $code")
            lib.delete()
            stripped.renameTo(lib)
        }
        rustSymbolsZip.parentFile.mkdirs()
        rustSymbolsZip.delete()
        ZipOutputStream(rustSymbolsZip.outputStream()).use { out ->
            rustSymbolsDir.walk().filter { it.isFile }.forEach { f ->
                out.putNextEntry(ZipEntry(f.relativeTo(rustSymbolsDir).invariantSeparatorsPath))
                f.inputStream().use { it.copyTo(out) }
                out.closeEntry()
            }
        }
    }
}
tasks.configureEach {
    if (name == "mergeUniversalReleaseJniLibFolders") dependsOn(stripRustRelease)
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    implementation("com.google.android.gms:play-services-games-v2:20.1.2")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = file("tauri.build.gradle.kts"))
