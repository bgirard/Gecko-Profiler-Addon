// -*- Mode: js2; tab-width: 2; indent-tabs-mode: nil; js2-basic-offset: 2; js2-skip-preprocessor-directives: t; -*-
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const {Cc,Ci,Cu} = require("chrome");

let main = require("main");
let data = require("self").data;
let cmdRunnerModule = Cu.import(data.url("CmdRunner.jsm"));


function RemoteHost(options, cb, error_cb) {
  this._adbCommand = "adb";
  this._addr2lineCommand = "addr2line";
  this._adbLibCache = "/tmp/";
  if (options.serial) {
    this._adbCommand = "adb -s " + options.serial;
  }
  if (options.addr2lineCommand) {
    this._addr2lineCommand = options.addr2lineCommand;
  } else {
    error_cb({
      description: "No addr2line path given.",
    });
    return;
  }
  cb(this);
}

RemoteHost.prototype.setAdbLibCache = function RemoteHost_setAdbLibCache(val) {
  this._adbLibCache = val;
};

RemoteHost.prototype.forwardPort = function RemoteHost_forwardPort(port, cb, error_cb) {
  cmdRunnerModule.runCommand(this._adbCommand + " forward tcp:" + port + " tcp:" + port + " 2>&1", function (r) {
    if (r.indexOf("error: device not found") >= 0) {
      error_cb({description: r});
    } else if (r.indexOf("error: cannot bind socket") >= 0) {
      error_cb({description: "cannot bind socket"});
    } else if (r.indexOf("error") >= 0) {
      error_cb({description: r});
    } else {
      cb();
    }
  });
};

exports.CreateRemoteHost = function CreateRemoteHost(options, cb, error_cb) {
  exports.HasPreReq(function success(results) {
    options.addr2lineCommand = results.addr2line_path;
    new RemoteHost(options, cb, error_cb);
  }, function error(e) {
    error_cb(e);
  });
}

exports.HasPreReq = function(cb, error_cb) {
  var results = {};
  cmdRunnerModule.runCommand("adb -version 2>&1", function (r) {
    if (r.indexOf("Android Debug Bridge") >= 0) {
      cmdRunnerModule.runCommand("which arm-eabi-addr2line", function (r) {
        if (r.indexOf("/") == 0) {
          results.addr2line_path = r;
          cb(results); 
        } else {
          error_cb({
            description: "Please install the android NDK and place 'arm-eabi-addr2line' in your path.",
            url: "http://developer.android.com/tools/sdk/ndk/index.html"
          });
        }
      });
    } else {
      error_cb({
        description: "Please install the android SDK and place 'adb' in your path.",
        url: "http://developer.android.com/sdk/index.html"
      });
    }
  });
};

exports.RemoteHost = RemoteHost;
