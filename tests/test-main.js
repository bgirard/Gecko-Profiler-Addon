const m = require("main");
const self = require("self");

exports.testHarness = function(test) {
  console.log("test harness");
  test.assert(true);
};

exports.testHarness2 = function(test) {
  console.log("test harness2");
  test.assert(true);
};

