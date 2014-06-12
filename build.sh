#!/bin/bash

set -e

if [ ! -d "sdk/packages/addon-pathfinder" ]; then
  echo "Must download the sdk and pathfinder addon first. See bootstrap.sh or the README for more info"
  exit
fi

cd sdk
. ./bin/activate
cd ..

cfx xpi
sh thunderbird_repack.sh
mv geckoprofiler.xpi geckoprofiler_amo.xpi

cfx xpi --update-link https://github.com/bgirard/Gecko-Profiler-Addon/raw/master/geckoprofiler.xpi --update-url https://github.com/bgirard/Gecko-Profiler-Addon/raw/master/geckoprofiler.update.rdf
sh thunderbird_repack.sh
