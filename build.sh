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
cfx xpi --update-url https://github.com/bgirard/Gecko-Profiler-Addon/raw/master/geckoprofiler.xpi
