"""Create a separate checkout from a verified Windows source snapshot."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tarfile


def main():
    job, expected_bundle, expected_source = sys.argv[1:]
    job = Path(job).resolve()
    for name, expected in [('source.bundle', expected_bundle), ('source.tgz', expected_source)]:
        digest = hashlib.sha256()
        with (job / name).open('rb') as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                digest.update(chunk)
        if digest.hexdigest() != expected:
            raise SystemExit('Source transfer hash mismatch: ' + name)
    app = job / 'app'
    if app.exists():
        raise SystemExit('Refusing to overwrite an existing source checkout.')
    subprocess.run(['git', 'init', '--quiet', str(app)], check=True)
    subprocess.run(['git', '-C', str(app), 'fetch', '--quiet', str(job / 'source.bundle'), 'HEAD'], check=True)
    subprocess.run(['git', '-C', str(app), 'checkout', '--quiet', '--detach', 'FETCH_HEAD'], check=True)
    # Only regular source files, directories, and contained relative names are accepted.
    with tarfile.open(job / 'source.tgz') as archive:
        members = archive.getmembers()
        for member in members:
            path = PurePosixPath(member.name)
            if (path.is_absolute() or '..' in path.parts or '.git' in path.parts
                    or '\\' in member.name or not (member.isfile() or member.isdir())):
                raise SystemExit('Unsafe source archive member.')
        archive.extractall(app, members=members)
    # A tracked file deleted in the local checkout must also be absent in the snapshot.
    present = {member.name.removeprefix('./') for member in members if member.isfile()}
    tracked = subprocess.check_output(['git', '-C', str(app), 'ls-files', '-z']).decode().split('\0')
    for path in filter(None, tracked):
        if path not in present:
            target = app / path
            if target.is_file():
                target.unlink()
    (job / 'source-receipt.json').write_text(json.dumps({
        'commit': subprocess.check_output(['git', '-C', str(app), 'rev-parse', 'HEAD']).decode().strip(),
        'bundleSha256': expected_bundle, 'sourceArchiveSha256': expected_source,
    }, indent=2) + '\n')
    print('Source snapshot verified in a separate checkout.')


if __name__ == '__main__':
    main()
