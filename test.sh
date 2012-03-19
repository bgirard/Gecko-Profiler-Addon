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
if [ -e /Users/bgirard/ssd-mozilla/mozilla-central/builds/obj-ff-64gdb/dist/Nightly.app ]
then
  cfx run --binary /Users/bgirard/ssd-mozilla/mozilla-central/builds/obj-ff-64gdb/dist/Nightly.app
  exit
fi

if [ -e /Users/markus/code/obj-m-debug/dist/NightlyDebug.app ]
then
  cfx run --binary /Users/markus/code/obj-m-debug/dist/NightlyDebug.app
  exit
fi

# or use nightly
cfx run --binary /Applications/FirefoxNightly.app
