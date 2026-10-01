#!/usr/bin/env python3
"""Prepare plugin files while Zotero is closed. Does not launch Zotero or open SQLite."""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import zipfile
from zoneinfo import ZoneInfo

parser = argparse.ArgumentParser()
parser.add_argument('--data', type=Path, required=True)
parser.add_argument('--profile', type=Path, required=True)
parser.add_argument('--package', type=Path, required=True)
parser.add_argument('--backup-root', type=Path, required=True)
args = parser.parse_args()
for process in ('zotero', 'Zotero'):
    status = subprocess.run(['pgrep', '-x', process], capture_output=True).returncode
    if status != 1:
        raise SystemExit('Zotero must be fully closed before preparing files.')
with zipfile.ZipFile(args.package) as package:
    manifest = json.loads(package.read('manifest.json'))
    if manifest['version'] != '0.1.0' or manifest['applications']['zotero']['id'] != 'similar-works@zhi.dev':
        raise SystemExit('Unexpected plugin identity or version.')
old_dir, new_dir = args.data / 'related-work', args.data / 'similar-works'
old_xpi = args.profile / 'extensions' / 'related-work@zhi.dev.xpi'
new_xpi = args.profile / 'extensions' / 'similar-works@zhi.dev.xpi'
prefs = args.profile / 'prefs.js'
if old_dir.exists() and new_dir.exists():
    raise SystemExit('Both data directories exist; refusing to choose or overwrite a database.')
if not (old_dir / 'similarity.sqlite').exists() and not (new_dir / 'similarity.sqlite').exists():
    raise SystemExit('Existing vector database not found; refusing to create an empty replacement.')
stamp = datetime.datetime.now(ZoneInfo('Asia/Shanghai')).strftime('%Y%m%d-%H%M%S')
backup = args.backup_root / stamp
backup.mkdir(parents=True, exist_ok=False)
shutil.copytree(old_dir if old_dir.exists() else new_dir, backup / 'vector-data')
for file in (old_xpi, new_xpi, prefs, args.profile / 'extensions.json'):
    if file.exists():
        shutil.copy2(file, backup / file.name)
text = prefs.read_text()
known = {'recommendationCount', 'minTokenLength', 'maxTextChars', 'backgroundIndexing', 'indexDelayMs',
         'allowMetadataOnlyRecommendations', 'minFulltextTerms', 'recommendationRefreshIntervalMs',
         'backgroundStartupDelayMs', 'requestMissingFulltext'}
lines = []
for line in text.splitlines(keepends=True):
    match = re.match(r'user_pref\("extensions\.zotero\.relatedwork\.([^"\n]+)"', line)
    if match:
        name = match.group(1)
        if name in known and '"extensions.zotero.similarworks.' + name + '"' not in text:
            lines.append(line.replace('extensions.zotero.relatedwork.', 'extensions.zotero.similarworks.'))
    else:
        lines.append(line)
moved = False
try:
    if old_dir.exists():
        old_dir.rename(new_dir)
        moved = True
    # Remove the legacy package from the load directory so it cannot recreate the old database.
    if old_xpi.exists():
        old_xpi.unlink()  # Original bytes are retained in the rollback backup.
    temporary = new_xpi.with_suffix('.xpi.new')
    shutil.copy2(args.package, temporary)
    os.replace(temporary, new_xpi)
    temporary_prefs = prefs.with_suffix('.js.new')
    temporary_prefs.write_text(''.join(lines))
    os.replace(temporary_prefs, prefs)
except Exception:
    if moved:
        new_dir.rename(old_dir)
    for file in (old_xpi, new_xpi, prefs):
        saved = backup / file.name
        if saved.exists():
            shutil.copy2(saved, file)
        elif file == new_xpi and file.exists():
            file.unlink()
    raise
print(json.dumps({'backup': str(backup), 'database': str(new_dir / 'similarity.sqlite'),
                  'package': str(new_xpi), 'version': '0.1.0',
                  'zotero_started': False, 'tests_run': False}, ensure_ascii=False, indent=2))
