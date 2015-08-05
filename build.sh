#!/bin/bash

set -e

rm -rf geckoprofiler.xpi
jpm xpi
#sh thunderbird_repack.sh
mv jid0-edalmuivkozlouyij0lpdx548bc@jetpack-1.16.7.xpi geckoprofiler.xpi
#cp geckoprofiler.xpi geckoprofiler_amo.xpi

#jpm xpi https://github.com/bgirard/Gecko-Profiler-Addon/raw/master/geckoprofiler.xpi --update-url https://github.com/bgirard/Gecko-Profiler-Addon/raw/master/geckoprofiler.update.rdf
#sh thunderbird_repack.sh
