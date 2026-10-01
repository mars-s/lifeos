#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
swift build >/dev/null
BIN="$(mktemp -d /tmp/lifeos-bulk-tests.XXXXXX)/reader-tests"
trap 'rm -rf "$(dirname "$BIN")"' EXIT
swiftc -parse-as-library -I .build/debug/Modules -I Sources/CSQLite \
  Sources/LifeOSSync/BulkPublicThings.swift Tests/BulkThingsReaderTests.swift \
  .build/debug/SyncCore.build/*.o -o "$BIN"
"$BIN" "$@"
