#!/bin/bash
if [ ! -d "sdk" ]; then
  echo "Must download the sdk first:"
  echo "git clone https://github.com/mozilla/addon-sdk sdk"
  echo "cd sdk && git checkout 1.4"
  exit
fi

cd sdk
. ./bin/activate
cd ..
cfx xpi --update-link https://example.com/addon/latest
