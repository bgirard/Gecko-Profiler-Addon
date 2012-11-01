hash git 2> /dev/null || {
  echo "You must have git installed to bootstrap"
  exit -1
}

git clone https://github.com/mozilla/addon-sdk sdk
cd sdk
git checkout 1.10
cd packages
git clone https://github.com/erikvold/vold-utils-jplib
git clone https://github.com/erikvold/xulkeys-jplib
git clone https://github.com/erikvold/toolbarbutton-jplib/
