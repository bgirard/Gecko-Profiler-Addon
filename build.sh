#!/bin/bash

set -e

cd src
rm -rf geckoprofiler.xpi geckoprofiler-unsigned.xpi
jpm xpi
#sh thunderbird_repack.sh
#mv jid0-edalmuivkozlouyij0lpdx548bc@jetpack-*.xpi geckoprofiler.xpi
#cp geckoprofiler.xpi geckoprofiler_amo.xpi

#jpm xpi https://github.com/bgirard/Gecko-Profiler-Addon/raw/master/geckoprofiler.xpi --update-url https://github.com/bgirard/Gecko-Profiler-Addon/raw/master/geckoprofiler.update.rdf
#sh thunderbird_repack.sh

cd ..
./firefox_repack.sh
mv src/geckoprofiler.xpi src/geckoprofiler-unsigned.xpi
