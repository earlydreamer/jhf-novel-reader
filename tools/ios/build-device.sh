#!/bin/bash
# Called by the one-shot login-session job. Never selects a simulator destination.
set -euo pipefail
project="$1"
device="$2"
team="$3"
job="$4"
action="${5:-install}"
base="$HOME/.local/share/jhf-ios"
. "$base/env.sh"
owned_lock=0
finish() {
    status=$?
    if [ "$owned_lock" = 1 ]; then rmdir "$base/iphone-build.lock"; fi
    printf '{"exitCode":%s,"completedAt":"%s"}\n' "$status" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$job/result.json.tmp"
    mv "$job/result.json.tmp" "$job/result.json"
}
trap finish EXIT
if ! mkdir "$base/iphone-build.lock"; then
    printf 'Another iPhone build is running.\n' >&2; exit 75
fi
owned_lock=1
cd "$project"
xcrun devicectl device info details --device "$device" --timeout 30 --json-output "$job/device.json" > "$job/device.log" 2>&1
destination=$(/usr/bin/python3 - "$job/device.json" <<'PY'
import json, sys
device = json.load(open(sys.argv[1]))['result']
if device.get('connectionProperties', {}).get('pairingState') != 'paired':
    raise SystemExit('Pair the physical iPhone first.')
if device.get('deviceProperties', {}).get('developerModeStatus') != 'enabled':
    raise SystemExit('Enable Developer Mode on the physical iPhone first.')
print(device['hardwareProperties']['udid'])
PY
)
derived="${JHF_DEVICE_DERIVED_DATA:-$base/product-derived-data}"
args=(-jobs 2 -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination "id=$destination" -derivedDataPath "$derived" -allowProvisioningUpdates -allowProvisioningDeviceRegistration "DEVELOPMENT_TEAM=$team" CODE_SIGN_STYLE=Automatic)
if [ "$action" = test ]; then
    xcodebuild "${args[@]}" -parallel-testing-enabled NO -resultBundlePath "$job/DeviceTests.xcresult" test > "$job/xcodebuild.log" 2>&1
else
    xcodebuild "${args[@]}" build > "$job/xcodebuild.log" 2>&1
fi
app="$derived/Build/Products/Debug-iphoneos/App.app"
/usr/bin/codesign --verify --deep --strict "$app"
xcrun devicectl device install app --timeout 120 --device "$device" "$app" > "$job/install.log" 2>&1
xcrun devicectl device process launch --timeout 60 --device "$device" dev.earlydreamer.jhfreader > "$job/launch.log" 2>&1
/usr/bin/python3 - "$app" "$job" <<'PY'
import json, pathlib, plistlib, sys
app, job = map(pathlib.Path, sys.argv[1:])
info = plistlib.load((app / 'Info.plist').open('rb'))
provenance = json.load((app / 'public/source-provenance.json').open())
receipt = {'bundleId': info['CFBundleIdentifier'], 'version': info['CFBundleShortVersionString'],
           'source': provenance, 'signedApp': str(app), 'installed': True, 'launched': True}
(job / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
PY
cat "$job/install.log" "$job/launch.log"
