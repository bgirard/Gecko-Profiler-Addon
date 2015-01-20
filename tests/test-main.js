const m = require("main");
const self = require("self");

exports.smokeTest = function(test) {
  m.main();
  m.getProfiler().isActive(function(val) {
    test.assert(val);
    m.onUnload();
  });
};

exports.testHarness2 = function(test) {
  m.main();
  m.getProfiler().getFeatures(function(features) {
    test.assert(features.length > 0);
    // js is a core profiler features and should always be there
    test.assert(features.indexOf("js") != -1);
    m.onUnload();
  });
};

