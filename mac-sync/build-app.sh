#!/bin/sh
set -eu
cd "$(dirname "$0")"
swift build -c release
APP="build/LifeOS Sync.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp .build/release/LifeOSSync "$APP/Contents/MacOS/LifeOSSync"
cp Resources/Info.plist "$APP/Contents/Info.plist"
cp Resources/native-write.js "$APP/Contents/Resources/"
cp ../cloud-mirror/lifeos_cache/things_read.js "$APP/Contents/Resources/"
/usr/bin/osacompile -o "$APP/Contents/Resources/things_classify.scpt" ../cloud-mirror/lifeos_cache/things_classify.applescript
/usr/bin/codesign --force --sign "${LIFEOS_CODESIGN_IDENTITY:--}" --options runtime --entitlements Resources/entitlements.plist "$APP"
/usr/bin/codesign --verify --strict "$APP"
printf '%s\n' "Built $APP. Secure activation is separate."
