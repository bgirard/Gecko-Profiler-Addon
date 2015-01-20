const m = require("main");
const self = require("self");

function startTest(test) {
  test.waitUntilDone(5000);
  m.main();
}

function stopTest(test) {
  m.onUnload();

  // Close cleopatra first
  var tabs = require("sdk/tabs");
  for (let tab of tabs) {
    if (tab.url.indexOf("cleopatra") != -1) {
      console.log("Close cleopatra");
      tab.close();
    }
  }
  // Close remaining tabs
  var tabs = require("sdk/tabs");
  for (let tab of tabs) {
    console.log("TAB: " + tab.url);
  }

  test.done();
}

exports.smokeTest = function(test) {
  startTest(test);

  m.getProfiler().isActive(function(val) {
    test.assert(val);

    stopTest(test);
  });
};

exports.openCleopatra = function(test) {
  startTest(test);

  m.getAppWrapper().open_cleopatra(null, null, function complete_callback(aProfile) {
    aProfile = JSON.parse(aProfile);

    // Here we should have a symbolicated profile!
    test.assert(aProfile != null);
    test.assert(aProfile['format'] === "profileJSONWithSymbolicationTable,1");
    test.assert(aProfile.profileJSON != null);
    test.assert(aProfile.profileJSON != null);
    test.assert(aProfile.profileJSON.libs != null);

    stopTest(test);
  });
};

exports.viewProfile = function(test) {
  startTest(test);

  m.getProfiler().getFeatures(function(features) {
    test.assert(features.length > 0);
    // js is a core profiler features and should always be there
    test.assert(features.indexOf("js") != -1);

    stopTest(test);
  });
};

