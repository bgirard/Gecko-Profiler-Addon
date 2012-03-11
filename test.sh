#!/bin/bash
if [ ! -d "sdk" ]; then
  echo "Must download the sdk first:"
  echo "git clone https://github.com/mozilla/addon-sdk sdk"
  echo "cd sdk && git checkout 1.4i && cd .."
  exit
fi

cd sdk
. ./bin/activate
cd ..

cfx run --binary /Applications/FirefoxNightly.app
#cfx run --binary /Users/markus/code/obj-m-debug/dist/NightlyDebug.app
