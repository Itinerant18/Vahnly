#!/bin/bash
# Generate app icons for iOS and Android from scripts/icon-source.svg.
# Usage: ./scripts/generate-icons.sh client-app
#        ./scripts/generate-icons.sh rider-app
# Requires: imagemagick (brew install imagemagick)
set -euo pipefail

APP_DIR="${1:?Usage: $0 <app-dir> (client-app or rider-app)}"
SOURCE="scripts/icon-source.svg"

if [[ ! -f "$SOURCE" ]]; then
  echo "Error: $SOURCE not found. Replace it with your 1024×1024 app icon SVG."
  exit 1
fi

command -v convert >/dev/null || { echo "Error: imagemagick not installed (brew install imagemagick)"; exit 1; }

# ── iOS ──────────────────────────────────────────────────────────────────────
IOS_ASSETS="$APP_DIR/ios/App/App/Assets.xcassets/AppIcon.appiconset"
if [[ -d "$APP_DIR/ios" ]]; then
  mkdir -p "$IOS_ASSETS"

  declare -A IOS_SIZES=(
    ["Icon-20.png"]=20
    ["Icon-20@2x.png"]=40
    ["Icon-20@3x.png"]=60
    ["Icon-29.png"]=29
    ["Icon-29@2x.png"]=58
    ["Icon-29@3x.png"]=87
    ["Icon-40.png"]=40
    ["Icon-40@2x.png"]=80
    ["Icon-40@3x.png"]=120
    ["Icon-60@2x.png"]=120
    ["Icon-60@3x.png"]=180
    ["Icon-76.png"]=76
    ["Icon-76@2x.png"]=152
    ["Icon-83.5@2x.png"]=167
    ["Icon-1024.png"]=1024
  )

  for filename in "${!IOS_SIZES[@]}"; do
    size="${IOS_SIZES[$filename]}"
    convert -background none -resize "${size}x${size}" "$SOURCE" "$IOS_ASSETS/$filename"
    echo "  iOS: $filename (${size}px)"
  done

  # Write Contents.json for Xcode
  cat > "$IOS_ASSETS/Contents.json" << 'JSON'
{
  "images": [
    {"idiom":"iphone","scale":"2x","size":"20x20","filename":"Icon-20@2x.png"},
    {"idiom":"iphone","scale":"3x","size":"20x20","filename":"Icon-20@3x.png"},
    {"idiom":"iphone","scale":"2x","size":"29x29","filename":"Icon-29@2x.png"},
    {"idiom":"iphone","scale":"3x","size":"29x29","filename":"Icon-29@3x.png"},
    {"idiom":"iphone","scale":"2x","size":"40x40","filename":"Icon-40@2x.png"},
    {"idiom":"iphone","scale":"3x","size":"40x40","filename":"Icon-40@3x.png"},
    {"idiom":"iphone","scale":"2x","size":"60x60","filename":"Icon-60@2x.png"},
    {"idiom":"iphone","scale":"3x","size":"60x60","filename":"Icon-60@3x.png"},
    {"idiom":"ipad","scale":"1x","size":"20x20","filename":"Icon-20.png"},
    {"idiom":"ipad","scale":"2x","size":"20x20","filename":"Icon-20@2x.png"},
    {"idiom":"ipad","scale":"1x","size":"29x29","filename":"Icon-29.png"},
    {"idiom":"ipad","scale":"2x","size":"29x29","filename":"Icon-29@2x.png"},
    {"idiom":"ipad","scale":"1x","size":"40x40","filename":"Icon-40.png"},
    {"idiom":"ipad","scale":"2x","size":"40x40","filename":"Icon-40@2x.png"},
    {"idiom":"ipad","scale":"1x","size":"76x76","filename":"Icon-76.png"},
    {"idiom":"ipad","scale":"2x","size":"76x76","filename":"Icon-76@2x.png"},
    {"idiom":"ipad","scale":"2x","size":"83.5x83.5","filename":"Icon-83.5@2x.png"},
    {"idiom":"ios-marketing","scale":"1x","size":"1024x1024","filename":"Icon-1024.png"}
  ],
  "info": {"author":"xcode","version":1}
}
JSON

  echo "iOS icons written to $IOS_ASSETS/"
fi

# ── Android ──────────────────────────────────────────────────────────────────
ANDROID_RES="$APP_DIR/android/app/src/main/res"
if [[ -d "$APP_DIR/android" ]]; then
  declare -A ANDROID_SIZES=(
    ["mipmap-mdpi"]=48
    ["mipmap-hdpi"]=72
    ["mipmap-xhdpi"]=96
    ["mipmap-xxhdpi"]=144
    ["mipmap-xxxhdpi"]=192
  )

  for dir in "${!ANDROID_SIZES[@]}"; do
    size="${ANDROID_SIZES[$dir]}"
    mkdir -p "$ANDROID_RES/$dir"
    convert -background white -flatten -resize "${size}x${size}" "$SOURCE" "$ANDROID_RES/$dir/ic_launcher.png"
    # Adaptive icon foreground (transparent background, 108dp = 432px at 4x)
    convert -background none -resize "${size}x${size}" "$SOURCE" "$ANDROID_RES/$dir/ic_launcher_foreground.png"
    echo "  Android: $dir/ic_launcher.png (${size}px)"
  done

  # Adaptive icon background (solid white)
  for dir in "${!ANDROID_SIZES[@]}"; do
    size="${ANDROID_SIZES[$dir]}"
    convert -size "${size}x${size}" xc:white "$ANDROID_RES/$dir/ic_launcher_background.png"
  done

  # ic_launcher.xml adaptive icon descriptor (v26+)
  mkdir -p "$ANDROID_RES/mipmap-anydpi-v26"
  cat > "$ANDROID_RES/mipmap-anydpi-v26/ic_launcher.xml" << 'XML'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
XML

  echo "Android icons written to $ANDROID_RES/"
fi

echo "Done. Replace scripts/icon-source.svg with your actual brand icon and re-run."
