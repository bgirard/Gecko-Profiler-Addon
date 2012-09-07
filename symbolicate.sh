#!/bin/bash

# Script that will take as input a profile package

# Here we use a fixed nightly instead of a nightly so that the script doesn't break
# every 6 weeks when we bump the version number
ls firefox-17.0a1.en-US.linux-i686.tar.bz2 > /dev/null || {
  wget ftp://ftp.mozilla.org/pub/firefox/nightly/2012/08/2012-08-27-03-05-49-mozilla-central/firefox-17.0a1.en-US.linux-i686.tar.bz2
}

ls firefox > /dev/null || {
  tar -xvf firefox-17.0a1.en-US.linux-i686.tar.bz2
}

ls firefox-17.0a1.en-US.linux-i686.tests.zip > /dev/null || {
  wget ftp://ftp.mozilla.org/pub/firefox/nightly/2012/08/2012-08-27-03-05-49-mozilla-central/firefox-17.0a1.en-US.linux-i686.tests.zip
}

ls firefox/mochitest > /dev/null || {
  unzip -q firefox-17.0a1.en-US.linux-i686.tests.zip -d firefox
} 

# Copy the latest script files picked up by the shell
cp data/ProgressReporter.js firefox
cp data/SymbolicateXPCShell.js firefox
cp data/SymbolicateWorker.js firefox
cp data/SymbolicateMain.js firefox
cp data/CmdRunWorker.js firefox

cd firefox

# Stage the info in /tmp
unzip -q -o $1 -d /tmp
unzip -q -o /tmp/symbol.apk -d /tmp; cp /tmp/lib/armeabi-v7a/* /tmp/

# Symbolicate. The last line will be the profile
./run-mozilla.sh bin/xpcshell -g . -a . -f ProgressReporter.js -f SymbolicateXPCShell.js -f CmdRunWorker.js -f SymbolicateWorker.js SymbolicateMain.js /tmp/fennec_profile.txt > ../out.txt
cd ..

# Get the profile (last line)
tail -1 out.txt > symbolicated_profile.txt
rm out.txt

# Compress the profile
zip -q $2 symbolicated_profile.txt
rm symbolicated_profile.txt


