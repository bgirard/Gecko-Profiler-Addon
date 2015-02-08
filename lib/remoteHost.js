// -*- Mode: js2; tab-width: 2; indent-tabs-mode: nil; js2-basic-offset: 2; js2-skip-preprocessor-directives: t; -*-
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const {Cc,Ci,Cu} = require("chrome");
const { Task } = Cu.import("resource://gre/modules/Task.jsm", {});

let main = require("main");
let data = require("sdk/self").data;
let cmdRunnerModule = Cu.import(data.url("CmdRunner.jsm"));

String.prototype.endsWith = function(suffix) {
  return this.indexOf(suffix, this.length - suffix.length) !== -1;
};

function RemoteHost(options, cb, error_cb) {
  this._adbCommand = "adb";
  this._addr2lineCommand = "addr2line";
  this._systemLibCache = "/tmp/";
  this._fennecLibCache = "/tmp/";
  this._serial = options.serial;
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
  if (this._serial == null) {
    var self = this;
    this._fetchHardwareID(function(r) {
      if (r == null) {
        dump("FATAL: " + "You must have exactly one instance of Fennec running\n");
        error_cb({description: "You must have exactly one instance of Fennec running"});
        return;
      }
      self._serial = r; 
      cb(self);
    });
  } else {
    cb(this);
  }
}

RemoteHost.prototype.getHardwareID = function RemoteHost_getHardwareID() {
  return this._serial;
};

RemoteHost.prototype._fetchHardwareID = function RemoteHost__fetchHardwareID(cb) {
  if (this._serial) {
    cb(this._serial);
  }
  cmdRunnerModule.runCommand("/bin/bash -l -c 'adb devices'", function(r) {
    var connectedDevices = [];
    var lines = r.split("\n");
    for (var i = 0; i < lines.length; ++i) {
      var line = lines[i].trim().split(/\s+/);
      if (line.length < 2 || line[1] != "device")
        continue;
      connectedDevices.push(line[0]);
    }

    if (connectedDevices.length == 0) {
      dump("Zero devices found\n");
      cb(null);
      return;
    }

    if (connectedDevices.length != 1) {
      dump("More than 1 devices found\n");
      cb(null);
      return;
    }

    var hwid = connectedDevices[0];
    cb(hwid);
  });
};

RemoteHost.prototype.setAdbLibCache = function RemoteHost_setAdbLibCache(systemLibs, fennecLibs) {
  this._systemLibCache = systemLibs;
  this._fennecLibCache = fennecLibs || systemLibs;
};

RemoteHost.prototype.findApk = function RemoteHost_findApk(pkgName, cb, error_cb) {
  cmdRunnerModule.runCommand("/bin/bash -l -c 'adb shell pm path " + pkgName + "'", function (r) {
    var firstLine = r.split("\n")[0];
    if (firstLine.startsWith("package:")) {
      var apkFile = firstLine.substr("package:".length).trim();
      cb(apkFile);
    } else {
      error_cb({description: "Adb shell command 'pm path " + pkgName + "' did not find a package. Output was: " + r});
    }
  });
}

RemoteHost.prototype._listSystemLibs = function RemoteHost__listSystemLibs() {
  return Task.spawn(function*() {
    var libPaths = [ "/system/lib",
                     "/system/lib/egl",
                     "/system/lib/hw",
                     "/system/vendor/lib",
                     "/system/vendor/lib/egl",
                     "/system/vendor/lib/hw",
                     "/system/b2g" ];

    var pathsToList = libPaths.map(path => path + "/*").join(" ");
    var r = yield cmdRunnerModule.runCommand("/bin/bash -l -c 'adb shell ls -d " + pathsToList + "'");
    return r.split("\n").map(line => line.trim()).filter(line => line.endsWith(".so"));
  }.bind(this));
};

RemoteHost.prototype._updateSystemLibs = function RemoteHost__updateSystemLibs(progress_cb) {
  return Task.spawn(function*() {
    var libsToPull = yield this._listSystemLibs();
    var libCacheFolder = this._systemLibCache + "/" + this._serial;
    for (let i = 0; i < libsToPull.length; i++) {
      let srcLib = libsToPull[i];
      let pathParts = libsToPull[i].split("/");
      let libName = pathParts[pathParts.length-1];
      let destLib = libCacheFolder;
      // collapse all libs at /system/lib/... into /system/lib/ and all libs at /system/vendor/lib/... into /system/vendor/lib
      // to match jimdb (https://github.com/darchons/android-gdbutils/blob/0089ceb0a5290d315efc11a340e5b64ccd66a72e/python/fastload.py#L106)
      let libPathIndex = libsToPull[i].indexOf("/lib");
      if (libPathIndex >= 0) {
        destLib += libsToPull[i].substr(0, libPathIndex + 4);
      }
      destLib += "/" + libName;
      let r = yield cmdRunnerModule.runCommand("/bin/bash -c 'ls " + destLib + " || adb pull " + srcLib + " " + destLib + "'");
      progress_cb({description: "Pulled " + libName + " (" + (i+1) + "/" + libsToPull.length + ")"});
    }
  }.bind(this));
};

RemoteHost.prototype.updateApk = function RemoteHost_updateApk(srcApk, cb) {
  var libCacheFolder = this._fennecLibCache + "/" + this._serial;
  var destApk = libCacheFolder + "/symbol.apk";
  var destApkDateInfo = destApk + ".dateInfo";

  cmdRunnerModule.runCommand("/bin/bash -l -c 'cat " + destApkDateInfo + " && adb shell ls -l " + srcApk + "'", function (r) {
    var lines = r.split("\n");
    if (lines.length == 2 || lines.length == 3) {
      if (lines[0] == lines[1]) {
        // Up to date
        cb();
        return;
      }
    }

    var updateApkCommand = "";
    updateApkCommand += "rm -f " + destApk + " " + destApkDateInfo + ";";
    updateApkCommand += "adb pull " + srcApk + " " + destApk + " && ";
    updateApkCommand += "adb shell ls -l " + srcApk + " > " + destApkDateInfo + " && ";
    updateApkCommand += "unzip -o " + destApk + " -d \"" + libCacheFolder + "\";";
    updateApkCommand += "cp " + libCacheFolder + "/lib/armeabi-v7a/*.so \"" + libCacheFolder + "\";";
    updateApkCommand += "cp " + libCacheFolder + "/lib/armeabi/*.so \"" + libCacheFolder + "\";";
    updateApkCommand += "cp " + libCacheFolder + "/assets/*.so \"" + libCacheFolder + "\";";
    updateApkCommand += "cp " + libCacheFolder + "/assets/armeabi-v7a/*.so \"" + libCacheFolder + "\";";
    updateApkCommand += "cp " + libCacheFolder + "/assets/armeabi/*.so \"" + libCacheFolder + "\";";
    updateApkCommand += "for f in " + libCacheFolder + "/*; do if [ \"$(head -c 4 \"$f\")\" == \"SeZz\" ]; then echo Uncompressing \"$f\"; szip -d \"$f\"; fi; done;";

    cmdRunnerModule.runCommand("/bin/bash -l -c '" + updateApkCommand + "'", function (r) {
      cb();
    });
  });
};

// Make sure all the libraries are downloaded and update to date for symbolication.
RemoteHost.prototype.prepareLibs = function RemoteHost_prepareLibs(pkg, cb, error_cb, progress_cb) {
  progress_cb({description: "Finding process"});
  var self = this;
  cmdRunnerModule.runCommand("/bin/bash -l -c 'adb shell ps'", function(r) {
    function getPkg (line) {
      var columns = line.trim().split(" ");
      if (pkg) {
        return columns[columns.length - 1] === pkg ? pkg : null;
      }
      var match = columns[columns.length - 1].match(/^org\.mozilla\.\w+$/);
      return match && match[0];
    }
    var lines = r.split("\n");
    var processLine = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (getPkg(line)) {
        if (processLine != null) {
          error_cb({
            description: "Choose target package name.",
            pkgs: lines.map(getPkg).filter(function (elem) elem)
          });
          return;
        }
        processLine = line;
      }
    }
    if (processLine == null) {
      error_cb({description: "Fennec is not running."});
      return;
    }
    var processLineSplit = processLine.split(" ");
    var pid = null;
    var pkgName = null;
    // Assume the first number is the PID
    for (var i = 1; i < processLineSplit.length; i++) {
      if (processLineSplit[i].trim() != "") {
        try {
          pid = parseInt(processLineSplit[i].trim());
          break;
        } catch (e) {
          break;
        }
      }
    }
    pkgName = processLineSplit[processLineSplit.length-1].trim();
    if (pid == null || isNaN(pid)) {
      error_cb({error: "Could not find PID in: " + processLine});
      return;
    }
    progress_cb({description: "Preparing APK"});
    self.findApk(pkgName, function (apkFile) {
      self.updateApk(apkFile, function() {
        self._updateSystemLibs(progress_cb).then(function () {
          cb(pkgName);
        });
      });
    }, error_cb);
  });
}

RemoteHost.prototype.forwardPort = function RemoteHost_forwardPort(port, remotePort, pkgName, cb, error_cb) {
  cmdRunnerModule.runCommand("/bin/bash -l -c '" + this._adbCommand + " forward tcp:" + port + " localfilesystem:/data/data/" + pkgName + "/firefox-debugger-socket 2>&1'", function (r) {
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
  cmdRunnerModule.runCommand("/bin/bash -l -c 'adb version 2>&1'", function (r) {
    if (r.indexOf("Android Debug Bridge") >= 0) {
      cmdRunnerModule.runCommand("/bin/bash -l -c 'which arm-eabi-addr2line'", function (r) {
        if (r.indexOf("/") == 0) {
          results.addr2line_path = r;
          cmdRunnerModule.runCommand("/bin/bash -l -c 'which szip'", function (r) {
            if (r.indexOf("/") == 0) {
              results.szip = r;
              cb(results); 
            } else {
              error_cb({
                description: "Please install szip and place it in your path. http://people.mozilla.org/~bgirard/szip",
                url: "http://people.mozilla.org/~bgirard/szip"
              });
            }
          });
        } else {
          error_cb({
            description: "Please install the android NDK and place 'arm-eabi-addr2line' in your path. http://developer.android.com/tools/sdk/ndk/index.html",
            url: "http://developer.android.com/tools/sdk/ndk/index.html"
          });
        }
      });
    } else {
      error_cb({
        description: "Please install the android SDK and place 'adb' in your path. http://developer.android.com/sdk/index.html",
        url: "http://developer.android.com/sdk/index.html"
      });
    }
  });
};

exports.RemoteHost = RemoteHost;
