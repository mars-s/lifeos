#!/bin/zsh
set -euo pipefail
study_root="${0:A:h}"
cd "$study_root"
swift build
study_app="$study_root/LifeOS Design Study.app"
mkdir -p "$study_app/Contents/MacOS" "$study_app/Contents/Resources"
cp .build/debug/LifeOSStudy "$study_app/Contents/MacOS/LifeOSStudy"
cp ../shared/mountain.png "$study_app/Contents/Resources/mountain.png"
cp Info.plist "$study_app/Contents/Info.plist"
codesign --force --sign - "$study_app"
printf '%s\n' "$study_app"
