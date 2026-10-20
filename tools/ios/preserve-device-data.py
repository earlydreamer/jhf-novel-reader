"""Keep an external, private Library backup and verify protected data after install."""
import hashlib
import json
from pathlib import Path
import plistlib
import subprocess
import sys
import time


def digest(value):
    return hashlib.sha256(value).hexdigest()


def protected_snapshot(library, bundle):
    files = {}
    index_slots = []
    found_index = False
    for path in library.rglob('*'):
        if not path.is_file():
            continue
        relative = path.relative_to(library).as_posix()
        parts = path.parts
        if 'narou-reader' in parts:
            suffix = parts[parts.index('narou-reader') + 1:]
            # Titles, attempts, guidance and queued jobs are user state as well as bodies.
            # Work pages and the index's update timestamps may refresh during normal launch.
            if suffix and suffix[0] not in ('works', 'library'):
                files[relative] = digest(path.read_bytes())
            if len(suffix) == 2 and suffix[0] == 'library' and suffix[1] in ('index.0.json', 'index.1.json'):
                found_index = True
                envelope = json.loads(path.read_text())
                encoded = json.dumps([1, envelope['generation'], envelope['payload']],
                                     ensure_ascii=False, separators=(',', ':')).encode()
                if envelope.get('format') == 1 and envelope.get('checksum') == digest(encoded):
                    index_slots.append(envelope)
    plist = library / 'Preferences' / (bundle + '.plist')
    preferences = plistlib.loads(plist.read_bytes()) if plist.exists() else {}
    saved = {key: digest(plistlib.dumps({'value': value}, sort_keys=True))
             for key, value in preferences.items() if key.startswith('CapacitorStorage.')}
    if found_index and not index_slots:
        raise ValueError('No valid index in the external app backup.')
    latest = max(index_slots, key=lambda entry: entry['generation'])['payload'] if index_slots else {}
    return {'files': files, 'preferences': saved,
            'workIds': latest.get('workIds', []), 'versions': latest.get('versions', []),
            'recent': latest.get('recent', [])}


def run(device, folder, name, args):
    result_file = folder / (name + '.json')
    result = subprocess.run(['xcrun', 'devicectl', *args[:3], '--device', device,
                             '--json-output', str(result_file), *args[3:]], capture_output=True)
    (folder / (name + '.log')).write_bytes(result.stdout + result.stderr)
    if result.returncode:
        raise SystemExit('Device data protection failed at ' + name + '; private logs retained.')
    return json.loads(result_file.read_text())['result']


def main():
    phase, device, bundle, job = sys.argv[1:]
    if phase not in ('capture', 'verify') or bundle != 'dev.earlydreamer.jhfreader':
        raise SystemExit('Invalid protection phase or bundle.')
    job = Path(job).resolve()
    folder = job / ('data-before' if phase == 'capture' else 'data-after')
    folder.mkdir(mode=0o700)
    apps = run(device, folder, 'apps', ['device', 'info', 'apps'])['apps']
    present = any(app.get('bundleIdentifier') == bundle for app in apps)
    snapshot = {'installed': present}
    if present:
        run(device, folder, 'library-copy', ['device', 'copy', 'from', '--domain-type',
            'appDataContainer', '--domain-identifier', bundle, '--source', 'Library',
            '--destination', str(folder / 'Library')])
        snapshot.update(protected_snapshot(folder / 'Library', bundle))
    (folder / 'snapshot.json').write_text(json.dumps(snapshot, ensure_ascii=False, indent=2))
    if phase == 'capture':
        print('External app data backup captured; private files retained in job directory.')
        return
    before = json.loads((job / 'data-before/snapshot.json').read_text())
    matches = {key: before.get(key) == snapshot.get(key)
               for key in ('files', 'preferences', 'workIds', 'versions', 'recent')}
    passed = (not before['installed']) or (present and all(matches.values()))
    (job / 'data-preservation.json').write_text(json.dumps({
        'previouslyInstalled': before['installed'], 'passed': passed, 'matches': matches,
        'runtimeSettingsVerification': 'Required separately; file equality is not runtime consumption.',
    }, indent=2))
    if not passed:
        raise SystemExit('Protected app data changed after installation; retain backups and investigate.')
    print('Protected app data matches the external pre-install backup.')


if __name__ == '__main__':
    # Let the normal app initialize before reading the post-install container.
    if len(sys.argv) > 1 and sys.argv[1] == 'verify':
        time.sleep(2)
    main()
