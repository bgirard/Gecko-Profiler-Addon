#!/bin/bash

# Repack the extension to add an update url to the install manifest.

set -e 

cd src
rm -rf tmp
mkdir tmp
cp geckoprofiler.xpi tmp
cd tmp
unzip -q geckoprofiler.xpi
rm geckoprofiler.xpi
# Find the first instance of </em:targetApplication>, and insert the Thunderbird
# app description right after.
sed -e '/<\/em:targetApplication>/r ../fx_install.rdf' install.rdf > install.rdf.new
mv install.rdf.new install.rdf
zip -q -r ../geckoprofiler.xpi *
cd ..
rm -rf tmp
echo "Firefox repack completed."
