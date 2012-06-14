#!/bin/bash
rm -rf tmp
mkdir tmp
cp geckoprofiler.xpi tmp
cd tmp
unzip -q geckoprofiler.xpi

# Find the first instance of <!-- Front End MetaData -->, and insert the Thunderbird
# app description right before.
sed -e '/<!-- Front End MetaData -->/r ../tb_install.rdf' -e 'x;$G' install.rdf > install.rdf.new
mv install.rdf.new install.rdf
zip -q -r ../geckoprofiler.xpi *
echo "Thunderbird repack completed."
