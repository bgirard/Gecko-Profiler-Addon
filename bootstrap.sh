#!/bin/bash
hash git 2> /dev/null || {
  echo "You must have git installed to bootstrap"
  exit -1
}

git clone https://github.com/mozilla/addon-sdk sdk
cd sdk
git checkout 1.13.2
mkdir packages
cd packages
git clone https://github.com/erikvold/addon-pathfinder
