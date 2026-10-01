#!/bin/sh
set -e
cd "$(dirname "$0")"
rm -f similar-works.xpi
zip -r similar-works.xpi manifest.json bootstrap.js prefs.js icons locale src
python3 - <<'PYBUILD'
import hashlib
import json
from pathlib import Path
manifest = json.loads(Path('manifest.json').read_text())
app = manifest['applications']['zotero']
version = manifest['version']
updates = {'addons': {app['id']: {'updates': [{
    'version': version,
    'update_link': f'https://github.com/lzcn/zotero-similar-works/releases/download/v{version}/similar-works.xpi',
    'update_hash': 'sha256:' + hashlib.sha256(Path('similar-works.xpi').read_bytes()).hexdigest(),
    'applications': {'zotero': {'strict_min_version': app['strict_min_version'], 'strict_max_version': app['strict_max_version']}}
}]}}}
Path('updates.json').write_text(json.dumps(updates, indent=2) + '\n')
PYBUILD
echo "Built similar-works.xpi and updates.json"
