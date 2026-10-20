#!/bin/bash
# Called by the one-shot login-session job. Never selects a simulator destination.
set -euo pipefail
project="$1"
device="$2"
team="$3"
job="$4"
action="${5:-install}"
bundle="${6:-dev.earlydreamer.jhfreader}"
live_url="${7:-}"
case "$bundle" in dev.earlydreamer.jhfreader|dev.earlydreamer.jhfreader.envcheck) ;; *) exit 2;; esac
if [ "$action" = test ] && [ "$bundle" = dev.earlydreamer.jhfreader ]; then
    printf 'XCTest must use the isolated envcheck application.\n' >&2; exit 2
fi
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
args=(-jobs 2 -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination "id=$destination" -derivedDataPath "$derived" "DEVELOPMENT_TEAM=$team")
if [ "$bundle" = dev.earlydreamer.jhfreader ]; then
    args+=(-allowProvisioningUpdates -allowProvisioningDeviceRegistration CODE_SIGN_STYLE=Automatic)
else
    # Reuse only a valid profile already issued for this team's paired physical iPhone.
    profile=$(/usr/bin/python3 - "$bundle" "$team" "$destination" <<'PY'
from datetime import datetime
from pathlib import Path
import plistlib, subprocess, sys
bundle, team, device = sys.argv[1:]
for source in (Path.home() / 'Library/Developer/Xcode/UserData/Provisioning Profiles').glob('*.mobileprovision'):
    result = subprocess.run(['security', 'cms', '-D', '-i', str(source)], capture_output=True)
    if result.returncode:
        continue
    profile = plistlib.loads(result.stdout)
    if (profile.get('Entitlements', {}).get('application-identifier') == team + '.' + bundle
            and device in profile.get('ProvisionedDevices', [])
            and profile.get('ExpirationDate', datetime.min) > datetime.utcnow()):
        print(profile['UUID'])
        break
else:
    raise SystemExit('No existing valid research profile for this physical iPhone.')
PY
)
    # Xcode-managed Personal Team profiles require Automatic signing. Do not force a
    # provisioning profile on SPM resource bundles, which do not support profiles.
    test -n "$profile"
    args+=("JHF_APP_BUNDLE_ID=$bundle" CODE_SIGN_STYLE=Automatic 'CODE_SIGN_IDENTITY=Apple Development')
fi
if [ "$action" = test ]; then
    # A separate test host must also leave the real user's application untouched.
    /usr/bin/python3 tools/ios/preserve-device-data.py capture "$destination" dev.earlydreamer.jhfreader "$job"
    live_args=()
    if [ -n "$live_url" ]; then
        export TEST_RUNNER_JHF_REAL_SOURCE_URL="$live_url"
        live_args+=(-only-testing:JHFDeviceTests/DeviceSmokeTests/test06RealNarouWorkAddAndCheck)
    fi
    xcodebuild "${args[@]}" "${live_args[@]}" -parallel-testing-enabled NO -resultBundlePath "$job/DeviceTests.xcresult" test > "$job/xcodebuild.log" 2>&1
else
    xcodebuild "${args[@]}" build > "$job/xcodebuild.log" 2>&1
fi
app="$derived/Build/Products/Debug-iphoneos/App.app"
/usr/bin/codesign --verify --deep --strict "$app"
/usr/bin/python3 tools/ios/write-receipt.py "$app" "$job" "$bundle" signed
if [ "$bundle" = dev.earlydreamer.jhfreader ]; then
    /usr/bin/python3 tools/ios/preserve-device-data.py capture "$destination" "$bundle" "$job"
fi
xcrun devicectl device install app --timeout 120 --device "$device" "$app" > "$job/install.log" 2>&1
/usr/bin/python3 tools/ios/write-receipt.py "$app" "$job" "$bundle" installed
xcrun devicectl device process launch --timeout 60 --device "$device" "$bundle" > "$job/launch.log" 2>&1
if [ "$bundle" = dev.earlydreamer.jhfreader ] || [ "$action" = test ]; then
    /usr/bin/python3 tools/ios/preserve-device-data.py verify "$destination" dev.earlydreamer.jhfreader "$job"
fi
/usr/bin/python3 tools/ios/write-receipt.py "$app" "$job" "$bundle" launched
cat "$job/install.log" "$job/launch.log"
