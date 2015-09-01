#!/bin/bash

set -e

./bootstrap.sh

cd src
if [ ! -d "sdk" ]; then
  echo "Must download the sdk first:"
  echo "git clone https://github.com/mozilla/addon-sdk sdk"
  echo "cd sdk && git checkout 1.4 && cd .."
  exit
fi

# Check if a custom build is found first
#if [ -e /Applications/Earlybird.app ]
#then
#  jpm test -v -a thunderbird --binary /Applications/Earlybird.app
#  exit
#fi

if [ -e "$1" ]
then
  echo "Custom binary: $1"
  jpm test -v --binary "$1"
  exit
fi

if [ -e /home/v/Downloads/firefox/firefox ]
then
  jpm test -v --binary /home/v/Downloads/firefox/firefox
  exit
fi

if [ -e ./firefox/firefox ]
then
  jpm test -v --binary ./firefox/firefox
  exit
fi

if [ -e ~/firefox/firefox ]
then
  jpm test -v --binary ~/firefox/firefox
  exit
fi

if [ -e /Users/bgirard/mozilla/mozilla-central/builds/obj-ff-64gdb/dist/Nightly.app ]
then
  echo "64 gdb"
  jpm test -v --binary /Users/bgirard/mozilla/mozilla-central/builds/obj-ff-64gdb/dist/Nightly.app
  exit
fi

if [ -e /Volumes/Nightly/FirefoxNightly.app ]
then
  echo Nightly
  jpm test -v --binary /Volumes/Nightly/FirefoxNightly.app
  exit
fi

# or use nightly
if [ -e /Applications/FirefoxNightly.app ]
then
  echo Nightly
  jpm test -v --binary /Applications/FirefoxNightly.app
  exit
fi

jpm test -v
