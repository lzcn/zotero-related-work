#!/bin/sh
set -e
cd "$(dirname "$0")"
rm -f similar-works.xpi
zip -r similar-works.xpi manifest.json bootstrap.js prefs.js icons locale src
echo "Built similar-works.xpi"
