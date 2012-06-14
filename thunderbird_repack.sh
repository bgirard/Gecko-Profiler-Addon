#!/bin/bash
rm -rf tmp
mkdir tmp
cp geckoprofiler.xpi tmp
cd tmp
unzip geckoprofiler.xpi
sed 's/ec8030f7-c20a-464f-9b0e-13a3a9e97384/3550f703-e582-4d05-9a08-453d09bdfdc6/g' install.rdf > install.rdf.new
mv install.rdf.new install.rdf
sed 's/>9.0/>1.0/g' install.rdf > install.rdf.new
mv install.rdf.new install.rdf
sed 's/>10./>16./g' install.rdf > install.rdf.new
mv install.rdf.new install.rdf
zip -r ../geckoprofiler_thunderbird.xpi *
