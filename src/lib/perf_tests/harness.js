const {Cc,Ci,Cu} = require("chrome");
Cu.import("resource://gre/modules/Services.jsm");

let tests_basic = require("perf_tests/basic");

let harness_tests = {};

function register_test(test_module) {
  try {
    let test = test_module.test_manifest;
    dump("Register " + test.name + "\n");
    harness_tests[test.name] = test;
  } catch (e) {
    dump("Error loading test: " + e + "\n");
  }
}

exports.run_all_tests = function run_all_tests() {
  dump("calling\n");
  for (var i in harness_tests) {
    dump("Running test: " + i + "\n");
    try {
      harness_tests[i].start();
    } catch (e) {
      dump("Fail to run test: " + e + "\n");
    }
  }
};
//  run_test: function run_test(name) {
//    harness_tests[name].start();
//  }
//};

register_test(tests_basic);

