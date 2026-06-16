#!/bin/bash
# Run ONCE per app after: cd <app-dir> && npx cap add android
# Usage: ./scripts/android-post-setup.sh client-app
#        ./scripts/android-post-setup.sh rider-app
# Requires: Android SDK installed (or run inside Android Studio terminal).
set -euo pipefail

APP_DIR="${1:?Usage: $0 <app-dir> (client-app or rider-app)}"
MANIFEST="$APP_DIR/android/app/src/main/AndroidManifest.xml"
BUILD_GRADLE="$APP_DIR/android/app/build.gradle"
VARIABLES_GRADLE="$APP_DIR/android/variables.gradle"

if [[ ! -f "$MANIFEST" ]]; then
  echo "Error: $MANIFEST not found. Run 'npx cap add android' in $APP_DIR first."
  exit 1
fi

echo "Patching AndroidManifest.xml permissions..."

# Add permissions before the <application> tag (idempotent — skip if already present)
add_permission() {
  local perm="$1"
  if ! grep -q "$perm" "$MANIFEST"; then
    sed -i.bak "s|<application|<uses-permission android:name=\"$perm\"/>\n    <application|" "$MANIFEST"
  fi
}

add_permission "android.permission.ACCESS_FINE_LOCATION"
add_permission "android.permission.ACCESS_COARSE_LOCATION"
add_permission "android.permission.ACCESS_BACKGROUND_LOCATION"
add_permission "android.permission.CAMERA"
add_permission "android.permission.VIBRATE"
add_permission "android.permission.RECEIVE_BOOT_COMPLETED"
add_permission "android.permission.POST_NOTIFICATIONS"

# FCM service + notification channel (inside <application>)
if ! grep -q "com.google.firebase.MESSAGING_EVENT" "$MANIFEST"; then
  sed -i.bak "s|</application>|    <service\n            android:name=\".MyFirebaseMessagingService\"\n            android:exported=\"false\">\n            <intent-filter>\n                <action android:name=\"com.google.firebase.MESSAGING_EVENT\" />\n            </intent-filter>\n        </service>\n    </application>|" "$MANIFEST"
fi

rm -f "${MANIFEST}.bak"

echo "Patching build.gradle SDK versions and signing config..."

# SDK versions — patch variables.gradle if it exists (Capacitor 5+)
if [[ -f "$VARIABLES_GRADLE" ]]; then
  sed -i.bak \
    -e "s/minSdkVersion = .*/minSdkVersion = 26/" \
    -e "s/compileSdkVersion = .*/compileSdkVersion = 34/" \
    -e "s/targetSdkVersion = .*/targetSdkVersion = 34/" \
    "$VARIABLES_GRADLE"
  rm -f "${VARIABLES_GRADLE}.bak"
fi

# Add signing config to app/build.gradle if not already present
if ! grep -q "signingConfigs" "$BUILD_GRADLE"; then
  cat >> "$BUILD_GRADLE" << 'GRADLE'

android {
    signingConfigs {
        release {
            keyAlias     System.getenv("KEY_ALIAS")     ?: ""
            keyPassword  System.getenv("KEY_PASSWORD")  ?: ""
            storeFile    System.getenv("KEYSTORE_PATH") ? file(System.getenv("KEYSTORE_PATH")) : null
            storePassword System.getenv("STORE_PASSWORD") ?: ""
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
}
GRADLE
fi

echo "Copying google-services.json from firebase/..."
if [[ -f "firebase/google-services.json" ]]; then
  cp "firebase/google-services.json" "$APP_DIR/android/app/google-services.json"
  echo "  → $APP_DIR/android/app/google-services.json"
else
  echo "  Warning: firebase/google-services.json not found — check firebase/ directory"
fi

# Add Firebase BoM + google-services plugin to app/build.gradle
if ! grep -q "firebase-bom" "$BUILD_GRADLE"; then
  # Add dependencies
  sed -i.bak "s|dependencies {|dependencies {\n    implementation platform('com.google.firebase:firebase-bom:33.0.0')\n    implementation 'com.google.firebase:firebase-messaging'|" "$BUILD_GRADLE"
  rm -f "${BUILD_GRADLE}.bak"
fi
if ! grep -q "com.google.gms.google-services" "$BUILD_GRADLE"; then
  echo "" >> "$BUILD_GRADLE"
  echo "apply plugin: 'com.google.gms.google-services'" >> "$BUILD_GRADLE"
fi

# Write MyFirebaseMessagingService.kt
PACKAGE="com.vahnly.$(basename $APP_DIR | sed 's/client-app/driver/;s/rider-app/rider/')"
KOTLIN_DIR="$APP_DIR/android/app/src/main/java/$(echo $PACKAGE | tr '.' '/')"
mkdir -p "$KOTLIN_DIR"

cat > "$KOTLIN_DIR/MyFirebaseMessagingService.kt" << KOTLIN
package $PACKAGE

import com.getcapacitor.plugin.NotificationPlugin
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class MyFirebaseMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        // Capacitor push plugin handles notification display automatically.
        // Add custom data handling here if needed.
    }

    override fun onNewToken(token: String) {
        // Token refresh — your app fetches the new token via PushNotifications.addListener("registration")
    }
}
KOTLIN

FLAVOR="$(basename "$APP_DIR" | sed 's/client-app/driver/;s/rider-app/rider/')"
echo ""
echo "Done. Remaining manual steps:"
echo "  1. Add google-services classpath to project-level android/build.gradle:"
echo "       classpath 'com.google.gms:google-services:4.4.2'   (inside buildscript.dependencies)"
echo "  2. Run: ./scripts/generate-icons.sh $APP_DIR   (launcher icons)"
echo "  3. Set applicationId in app/build.gradle to com.vahnly.$FLAVOR"
echo "  4. Open in Android Studio: cd $APP_DIR && npm run open:android"
