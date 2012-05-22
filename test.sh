#!/bin/bash
if [ ! -d "sdk" ]; then
  echo "Must download the sdk first:"
  echo "git clone https://github.com/mozilla/addon-sdk sdk"
  echo "cd sdk && git checkout 1.4 && cd .."
  exit
fi

cd sdk
. ./bin/activate
cd ..

# Check if a custom build is found first
#if [ -e /Applications/Earlybird.app ]
#then
#  cfx run -a thunderbird --binary /Applications/Earlybird.app
#  exit
#fi

if [ -e ./firefox/firefox ]
then
  cfx run --binary ./firefox/firefox
  exit
fi

if [ -e /Users/bgirard/ssd-mozilla/mozilla-central/builds/obj-ff-64gdb/dist/NightlyDebug.app ]
then
  echo "64 gdb"
  cfx run --binary /Users/bgirard/ssd-mozilla/mozilla-central/builds/obj-ff-64gdb/dist/NightlyDebug.app
  exit
fi

if [ -e /Users/markus/code/obj-m-opt/dist/Nightly.app ]
then
  cfx run --binary /Users/markus/code/obj-m-opt/dist/Nightly.app
  exit
fi

# or use nightly
cfx run --binary /Applications/FirefoxNightly.app
