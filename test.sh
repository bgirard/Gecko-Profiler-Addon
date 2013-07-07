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

if [ -e ~/firefox/firefox ]
then
  cfx run --binary ~/firefox/firefox
  exit
fi

if [ -e /Users/bgirard/ssd-mozilla/mozilla-central/builds/obj-ff-64gdb/dist/Nightly.app ]
then
  echo "64 gdb"
  cfx run --binary /Users/bgirard/ssd-mozilla/mozilla-central/builds/obj-ff-64gdb/dist/Nightly.app
  exit
fi

if [ -e /Volumes/Nightly/FirefoxNightly.app ]
then
  echo Nightly
  cfx run --binary /Volumes/Nightly/FirefoxNightly.app
  exit
fi

# or use nightly
if [ -e /Applications/FirefoxNightly.app ]
then
  echo Nightly
  cfx run --binary /Applications/FirefoxNightly.app
  exit
fi

echo "Unable to find a firefox installation!"
exit 1
