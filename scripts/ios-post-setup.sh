#!/bin/bash
# Run ONCE per app after: cd <app-dir> && npx cap add ios
# Usage: ./scripts/ios-post-setup.sh client-app
#        ./scripts/ios-post-setup.sh rider-app
# Requires: macOS with Xcode installed.
set -euo pipefail

APP_DIR="${1:?Usage: $0 <app-dir> (client-app or rider-app)}"
PLIST="$APP_DIR/ios/App/App/Info.plist"
APPDELEGATE="$APP_DIR/ios/App/App/AppDelegate.swift"

if [[ ! -f "$PLIST" ]]; then
  echo "Error: $PLIST not found. Run 'npx cap add ios' in $APP_DIR first."
  exit 1
fi

echo "Patching Info.plist permissions..."

PB=/usr/libexec/PlistBuddy

# Location — required by @capacitor/geolocation
$PB -c "Delete :NSLocationWhenInUseUsageDescription" "$PLIST" 2>/dev/null || true
$PB -c "Add :NSLocationWhenInUseUsageDescription string 'To show your location on the map'" "$PLIST"

$PB -c "Delete :NSLocationAlwaysAndWhenInUseUsageDescription" "$PLIST" 2>/dev/null || true
$PB -c "Add :NSLocationAlwaysAndWhenInUseUsageDescription string 'To track your location during trips'" "$PLIST"

# Camera — for driver KYC document upload
$PB -c "Delete :NSCameraUsageDescription" "$PLIST" 2>/dev/null || true
$PB -c "Add :NSCameraUsageDescription string 'To upload document photos'" "$PLIST"

$PB -c "Delete :NSPhotoLibraryUsageDescription" "$PLIST" 2>/dev/null || true
$PB -c "Add :NSPhotoLibraryUsageDescription string 'To select document photos from your library'" "$PLIST"

# Contacts — for emergency contact feature
$PB -c "Delete :NSContactsUsageDescription" "$PLIST" 2>/dev/null || true
$PB -c "Add :NSContactsUsageDescription string 'To add emergency contacts'" "$PLIST"

echo "Copying GoogleService-Info.plist from firebase/..."
FLAVOR="$(basename "$APP_DIR" | sed 's/client-app/driver/;s/rider-app/rider/')"
FIREBASE_PLIST="firebase/GoogleService-Info-${FLAVOR}.plist"
if [[ -f "$FIREBASE_PLIST" ]]; then
  cp "$FIREBASE_PLIST" "$APP_DIR/ios/App/App/GoogleService-Info.plist"
  echo "  → $APP_DIR/ios/App/App/GoogleService-Info.plist"
  echo "  NOTE: also add the file to the Xcode target via right-click → Add Files to 'App'"
else
  echo "  Warning: $FIREBASE_PLIST not found — check firebase/ directory"
fi

echo "Writing AppDelegate.swift with Firebase/FCM..."
# Requires: FirebaseMessaging SPM package — add in Xcode:
#   File → Add Package Dependencies → https://github.com/firebase/firebase-ios-sdk

cat > "$APPDELEGATE" << 'SWIFT'
import UIKit
import Capacitor
import UserNotifications
// Uncomment after adding FirebaseMessaging via Swift Package Manager:
// import FirebaseCore
// import FirebaseMessaging

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        // Uncomment after adding Firebase SPM package:
        // FirebaseApp.configure()

        UNUserNotificationCenter.current().delegate = self
        application.registerForRemoteNotifications()

        return true
    }

    // APNS token → Firebase Messaging
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        // Messaging.messaging().apnsToken = deviceToken
        NotificationCenter.default.post(
            name: .capacitorDidRegisterForRemoteNotifications,
            object: deviceToken
        )
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        NotificationCenter.default.post(
            name: .capacitorDidFailToRegisterForRemoteNotifications,
            object: error
        )
    }

    // UNUserNotificationCenterDelegate — foreground notification display
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.badge, .sound, .banner])
    }

    func application(
        _ app: UIApplication,
        open url: URL,
        options: [UIApplication.OpenURLOptionsKey: Any] = [:]
    ) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(
        _ application: UIApplication,
        continue userActivity: NSUserActivity,
        restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
    ) -> Bool {
        return ApplicationDelegateProxy.shared.application(
            application, continue: userActivity, restorationHandler: restorationHandler
        )
    }
}
SWIFT

echo ""
echo "Done. Remaining manual steps in Xcode:"
echo "  1. Add FirebaseMessaging via File → Add Package Dependencies:"
echo "       https://github.com/firebase/firebase-ios-sdk"
echo "       Select: FirebaseMessaging"
echo "  2. Uncomment FirebaseCore/FirebaseMessaging imports in AppDelegate.swift"
echo "  3. Right-click App folder in Xcode → Add Files → GoogleService-Info.plist (already copied)"
echo "     Ensure 'Add to target: App' is checked"
echo "  4. Replace placeholder icons: ./scripts/generate-icons.sh $APP_DIR"
echo "  5. Set bundle identifier in Signing & Capabilities to com.vahnly.$FLAVOR"
