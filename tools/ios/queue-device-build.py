"""Dispatch an ephemeral launchd job; no saved password, GUI IDE, or simulator."""
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys


def main():
    project, job, device, action = sys.argv[1:5]
    bundle = sys.argv[5] if len(sys.argv) > 5 else 'dev.earlydreamer.jhfreader'
    live_url = sys.argv[6] if len(sys.argv) > 6 else ''
    if live_url and (action != 'test' or not re.fullmatch(r'https://ncode\.syosetu\.com/n[0-9]{1,4}[a-z]{1,2}/', live_url)):
        raise SystemExit('Live source checks require test action and a canonical Narou work URL.')
    if bundle not in ('dev.earlydreamer.jhfreader', 'dev.earlydreamer.jhfreader.envcheck'):
        raise SystemExit('Invalid product or research bundle ID.')
    if action == 'test' and bundle == 'dev.earlydreamer.jhfreader':
        raise SystemExit('XCTest must use the isolated envcheck application, not the user app.')
    project, job = Path(project).resolve(), Path(job).resolve()
    base = Path.home() / '.local/share/jhf-ios'
    job.mkdir(parents=True, exist_ok=True)
    if device == 'auto':
        subprocess.run(['xcrun', 'devicectl', 'list', 'devices', '--timeout', '30', '--json-output', str(job / 'devices.json')], check=True, stdout=subprocess.DEVNULL)
        devices = json.loads((job / 'devices.json').read_text())['result']['devices']
        phones = [item['identifier'] for item in devices
                  if item.get('hardwareProperties', {}).get('deviceType') == 'iPhone'
                  and item.get('connectionProperties', {}).get('pairingState') == 'paired']
        if len(phones) != 1:
            raise SystemExit('Specify DeviceId when there is not exactly one paired iPhone.')
        device = phones[0]
    if not re.fullmatch(r'[A-Za-z0-9-]+', device) or action not in ('install', 'test'):
        raise SystemExit('Invalid device or action.')
    team = (base / 'development-team').read_text().strip()
    if not re.fullmatch(r'[A-Z0-9]{10}', team):
        raise SystemExit('Configure the development team on this Mac first.')
    label = 'dev.earlydreamer.jhf.product-build.' + job.name
    definition = {
        'Label': label,
        'ProgramArguments': ['/bin/bash', str(project / 'tools/ios/build-device.sh'),
                             str(project), device, team, str(job), action, bundle, live_url],
        'EnvironmentVariables': {'HOME': str(Path.home()), 'PATH': '/usr/bin:/bin:/usr/sbin:/sbin'},
        'RunAtLoad': True, 'KeepAlive': False,
        'StandardOutPath': str(job / 'build.log'), 'StandardErrorPath': str(job / 'build.log'),
    }
    with (job / 'job.plist').open('wb') as output:
        plistlib.dump(definition, output)
    subprocess.run(['/bin/launchctl', 'bootstrap', f'gui/{os.getuid()}', str(job / 'job.plist')], check=True)
    (job / 'launchd-label').write_text(label)
    print(json.dumps({'job': str(job), 'label': label, 'state': 'dispatched'}))


if __name__ == '__main__':
    main()
