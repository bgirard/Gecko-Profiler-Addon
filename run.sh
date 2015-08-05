#!/bin/bash

if [ -e /home/v/Downloads/firefox/firefox ]
then
  jpm run --binary /home/v/Downloads/firefox/firefox
  exit
fi

if [ -e ./firefox/firefox ]
then
  jpm run --binary ./firefox/firefox
  exit
fi

if [ -e ~/firefox/firefox ]
then
  jpm run --binary ~/firefox/firefox
  exit
fi

if [ -e /Users/bgirard/mozilla/mozilla-central/builds/obj-ff-64gdb/dist/Nightly.app ]
then
  echo "64 gdb"
  jpm run --binary /Users/bgirard/mozilla/mozilla-central/builds/obj-ff-64gdb/dist/Nightly.app
  exit
fi

if [ -e /Volumes/Nightly/FirefoxNightly.app ]
then
  echo Nightly
  jpm run --binary /Volumes/Nightly/FirefoxNightly.app
  exit
fi

# or use nightly
if [ -e /Applications/FirefoxNightly.app ]
then
  echo Nightly
  jpm run --binary /Applications/FirefoxNightly.app
  exit
fi

echo "Unable to find a firefox installation!"
exit 1
