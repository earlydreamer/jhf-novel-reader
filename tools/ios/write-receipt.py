"""Record each completed device stage without turning a partial run into success."""
import json
from pathlib import Path
import plistlib
import sys


def main():
    app, job, expected, stage = sys.argv[1:]
    app, job = Path(app), Path(job)
    info = plistlib.load((app / 'Info.plist').open('rb'))
    if info['CFBundleIdentifier'] != expected:
        raise SystemExit('The built app has an unexpected bundle ID.')
    path = job / 'receipt.json'
    receipt = json.loads(path.read_text()) if path.exists() else {
        'bundleId': info['CFBundleIdentifier'], 'version': info['CFBundleShortVersionString'],
        'source': json.loads((app / 'public/source-provenance.json').read_text()),
        'signedApp': str(app), 'signed': False, 'installed': False, 'launched': False,
    }
    if stage not in ('signed', 'installed', 'launched'):
        raise SystemExit('Invalid device stage.')
    receipt[stage] = True
    path.write_text(json.dumps(receipt, indent=2) + '\n')


if __name__ == '__main__':
    main()
