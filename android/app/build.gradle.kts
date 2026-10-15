// App Android da Central: o painel (WebView da própria central) + widgets na tela inicial.
// Versão: CENTRAL_VERSION (o CI passa a do release); assinatura: variáveis CENTRAL_KEYSTORE_* (secret no CI).
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val appVersion = (System.getenv("CENTRAL_VERSION") ?: "0.1.0")
val parts = appVersion.split(".").map { it.toIntOrNull() ?: 0 }

android {
    namespace = "com.yanngc32.central"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.yanngc32.central"
        minSdk = 26
        targetSdk = 35
        versionName = appVersion
        // 1.2.3 -> 10203: sempre cresce junto com a versão do release
        versionCode = parts[0] * 10000 + parts[1] * 100 + parts[2]
    }

    signingConfigs {
        create("release") {
            val store = System.getenv("CENTRAL_KEYSTORE_FILE")
            if (store != null) {
                storeFile = file(store)
                storePassword = System.getenv("CENTRAL_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("CENTRAL_KEY_ALIAS") ?: "central"
                keyPassword = System.getenv("CENTRAL_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (System.getenv("CENTRAL_KEYSTORE_FILE") != null) signingConfigs.getByName("release") else null
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
}
