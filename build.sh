#!/bin/bash

set -e

jpm xpi
sh thunderbird_repack.sh
mv jid0-edalmuivkozlouyij0lpdx548bc@jetpack-1.16.6.xpi geckoprofiler.xpi
mv geckoprofiler.xpi geckoprofiler_amo.xpi

jpm xpi --update-link https://github.com/bgirard/Gecko-Profiler-Addon/raw/master/geckoprofiler.xpi --update-url https://github.com/bgirard/Gecko-Profiler-Addon/raw/master/geckoprofiler.update.rdf
sh thunderbird_repack.sh
