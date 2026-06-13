#!/bin/bash
# Production build for both Capacitor apps.
# Run from the repo root. Requires npx cap add ios/android already done.
# Do NOT export DEV_SERVER_URL — production builds must serve bundled assets.
set -euo pipefail

unset DEV_SERVER_URL

echo "=== Building Driver App ==="
cd client-app
npm run build:ios
npm run build:android
cd ..

echo "=== Building Rider App ==="
cd rider-app
npm run build:ios
npm run build:android
cd ..

echo ""
echo "Done. Next steps:"
echo "  Driver iOS:     cd client-app && npm run open:ios   (archive in Xcode)"
echo "  Driver Android: cd client-app && npm run open:android  (generate signed APK/AAB)"
echo "  Rider iOS:      cd rider-app  && npm run open:ios"
echo "  Rider Android:  cd rider-app  && npm run open:android"
