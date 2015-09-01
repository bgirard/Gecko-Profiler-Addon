const {Cc,Ci,Cu} = require("chrome");
Cu.import("resource://gre/modules/Services.jsm");

let main = require("main");
let tabs = require('tabs');
let timers = require("timers");

function test_start() {
  main.test.start();
  run_google(function run_google_done() {
    main.test.stop();
  });
}

function run_google(done) {
  tabs.open({
    url: "http://www.cnn.com",
    onReady: function onReady(tab) {
      timers.setTimeout(function wait_for_load() {
        dump("loaded page\n");
        done();
      }, 2000);
    }
  });
}

exports.test_manifest = {
  name: "Basic",
  start: test_start,
};

