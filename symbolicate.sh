# Script that will take as input a profile package

# Here we use a fixed nightly instead of a nightly so that the script doesn't break
# every 6 weeks when we bump the version number
ls firefox-17.0a1.en-US.linux-i686.tar.bz2 > /dev/null || {
  wget ftp://ftp.mozilla.org/pub/firefox/nightly/2012/08/2012-08-27-03-05-49-mozilla-central/firefox-17.0a1.en-US.linux-i686.tar.bz2
}

ls firefox > /dev/null || {
  tar -xvf firefox-17.0a1.en-US.linux-i686.tar.bz2
}

ls firefox-17.0a1.en-US.linux-i686.tests.zip > /dev/null || {
  wget ftp://ftp.mozilla.org/pub/firefox/nightly/2012/08/2012-08-27-03-05-49-mozilla-central/firefox-17.0a1.en-US.linux-i686.tests.zip
}

ls firefox/mochitest > /dev/null || {
  unzip firefox-17.0a1.en-US.linux-i686.tests.zip -d firefox
} 

cd firefox
./run-mozilla.sh bin/xpcshell -a . blah.js 23234
