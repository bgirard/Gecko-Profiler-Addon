// -*- Mode: js2; tab-width: 2; indent-tabs-mode: nil; js2-basic-offset: 2; js2-skip-preprocessor-directives: t; -*-
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const {Cc,Ci,Cu} = require("chrome");

let main = require("main");
let data = require("self").data;
let cmdRunnerModule = Cu.import(data.url("CmdRunner.jsm"));

function RemoteHost(options) {
  this._adbCommand = "adb";
  if (options.serial) {
    this._adbCommand = "adb -s " + options.serial;
  }
}

exports.HasPreReq = function(cb, error_cb) {
  cmdRunnerModule.runCommand("adb -version 2>&1", function (r) {
    if (r.indexOf("Android Debug Bridge") >= 0) {
      cb();
    } else {
      error_cb({
        description: "Please install the android SDK and place 'adb' in your path.",
        url: "http://developer.android.com/sdk/index.html"
      });
    }
  });
};

exports.RemoteHost = RemoteHost;
