"""Validate the release with Python's independent ZIP reader; optionally reinstall it."""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--rebuild', action='store_true', help='Build again and compare archive hashes.')
parser.add_argument('--install', action='store_true', help='Run installed-extension tests against the extracted ZIP.')
parser.add_argument('--chromium', help='Browser executable; otherwise use the last full test run.')
args = parser.parse_args()
version = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))['version']
archive = ROOT / f'release/browser-toolbox-{version}.zip'
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
assert digest == archive.with_suffix('.zip.sha256').read_text().split()[0], 'Archive hash mismatch'
report = {'version': version, 'sha256': digest, 'bytes': archive.stat().st_size, 'passed': False}
if args.rebuild:
    subprocess.run(['node', 'scripts/package.mjs'], cwd=ROOT, check=True)
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == digest, 'Release is not reproducible'
    report['reproducible'] = True
inventory = json.loads((ROOT / 'release/files.json').read_text(encoding='utf-8'))
assert inventory['version'] == version
with zipfile.ZipFile(archive) as package:
    assert package.testzip() is None, 'ZIP CRC failure'
    expected = {'browser_toolbox_extension/' + name for name in inventory['files']}
    assert len(package.namelist()) == len(expected) and set(package.namelist()) == expected
    for name, expected_hash in inventory['files'].items():
        assert not Path(name).is_absolute() and '..' not in Path(name).parts
        assert name in {'manifest.json', 'README.md', 'popup.html', 'popup.css', 'file_to_image.html', 'file_to_image.css', 'youtube_layout.css', 'youtube_progress_theme.css'} or name.startswith(('dist/', 'icons/', 'assets/'))
        data = package.read('browser_toolbox_extension/' + name)
        assert hashlib.sha256(data).hexdigest() == expected_hash
        assert data == (ROOT / name).read_bytes(), name
    report['files'] = len(expected)
    report['crcAndInventory'] = True
    if args.install:
        browser = args.chromium
        if not browser:
            browser = json.loads((ROOT / '.test_results/all-summary.json').read_text(encoding='utf-8'))['browser']
        assert Path(browser).is_file(), 'Provide --chromium with an existing executable'
        with tempfile.TemporaryDirectory(prefix='browser-toolbox-package-') as temporary:
            # Every member was compared to the project's allowlist before extraction.
            package.extractall(temporary)
            subprocess.run([sys.executable, 'tests/run_installed_extension_tests.py', '--chromium', browser,
                            '--extension', str(Path(temporary) / 'browser_toolbox_extension')], cwd=ROOT, check=True)
            subprocess.run([sys.executable, 'tests/run_popup_window_tests.py', '--chromium', browser,
                            '--extension', str(Path(temporary) / 'browser_toolbox_extension')], cwd=ROOT, check=True)
            subprocess.run([sys.executable, 'tests/run_media_runtime_tests.py', '--chromium', browser,
                            '--extension', str(Path(temporary) / 'browser_toolbox_extension')], cwd=ROOT, check=True)
            subprocess.run([sys.executable, 'tests/run_quality_integration_tests.py', '--chromium', browser,
                           '--extension', str(Path(temporary) / 'browser_toolbox_extension')], cwd=ROOT, check=True)
            subprocess.run([sys.executable, 'tests/run_layout_integration_tests.py', '--chromium', browser,
                           '--extension', str(Path(temporary) / 'browser_toolbox_extension')], cwd=ROOT, check=True)
            subprocess.run([sys.executable, 'tests/run_state_preservation_tests.py', '--chromium', browser,
                           '--extension', str(Path(temporary) / 'browser_toolbox_extension')], cwd=ROOT, check=True)
        report['installedPackage'] = True
        report['actualToolbarPopup'] = True
        report['mediaRuntimeRecovery'] = True
        report['qualityPopupToContent'] = True
        report['layoutContentToNativeResize'] = True
        report['statePreservation'] = True
report['passed'] = True
output = ROOT / '.test_results/package-verification.json'
output.parent.mkdir(exist_ok=True)
output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, indent=2))
