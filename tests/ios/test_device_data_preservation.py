import hashlib
import importlib.util
import json
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('preservation', ROOT / 'tools/ios/preserve-device-data.py')
preservation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preservation)
BUNDLE = 'dev.earlydreamer.jhfreader'


class DeviceDataProtectionTests(unittest.TestCase):
    def test_snapshot_protects_settings_bodies_and_latest_valid_index_but_not_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            library = Path(directory)
            preferences = library / 'Preferences' / (BUNDLE + '.plist')
            preferences.parent.mkdir()
            preferences.write_bytes(plistlib.dumps({'CapacitorStorage.setting': 'private-sentinel',
                                                     'AppleTransientValue': 'ignored'}))
            root = library / 'NoCloud/narou-reader'
            (root / 'versions').mkdir(parents=True)
            body = root / 'versions/v1.0.json'
            body.write_text('protected-body')
            (root / 'library').mkdir()
            payload = {'workIds': ['fixture'], 'versions': [{'versionId': 'v1'}], 'recent': []}
            checksum = hashlib.sha256(json.dumps([1, 1, payload], ensure_ascii=False,
                                                 separators=(',', ':')).encode()).hexdigest()
            (root / 'library/index.0.json').write_text(json.dumps({
                'format': 1, 'generation': 1, 'payload': payload, 'checksum': checksum}))
            (root / 'library/index.1.json').write_text(json.dumps({
                'format': 1, 'generation': 2, 'payload': {}, 'checksum': 'invalid'}))
            first = preservation.protected_snapshot(library, BUNDLE)
            self.assertEqual(first['workIds'], ['fixture'])
            self.assertEqual(first['versions'], [{'versionId': 'v1'}])
            self.assertNotIn('private-sentinel', json.dumps(first))
            self.assertEqual(len(first['files']), 1)
            (library / 'cache').write_text('unprotected-cache')
            self.assertEqual(first, preservation.protected_snapshot(library, BUNDLE))
            body.write_text('changed-body')
            self.assertNotEqual(first['files'], preservation.protected_snapshot(library, BUNDLE)['files'])
            preferences.write_bytes(plistlib.dumps({'CapacitorStorage.setting': 'changed-setting'}))
            self.assertNotEqual(first['preferences'], preservation.protected_snapshot(library, BUNDLE)['preferences'])

    def test_dispatch_refuses_xctest_in_the_user_application_before_touching_device(self):
        result = subprocess.run([sys.executable, str(ROOT / 'tools/ios/queue-device-build.py'),
                                 'missing', 'missing', 'auto', 'test', BUNDLE], capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'isolated envcheck', result.stderr)


if __name__ == '__main__':
    unittest.main()
