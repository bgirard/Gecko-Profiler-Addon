// -*- Mode: js2; tab-width: 2; indent-tabs-mode: nil; js2-basic-offset: 2; js2-skip-preprocessor-directives: t; -*-
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const {Cc,Ci,Cu} = require("chrome");

let main = require("main");
let data = require("self").data;
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
      cb(null);
      return;
    }

    if (connectedDevices.length != 1) {
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
  function foundApk(prefix, ext, r, numb) {
    cb({
      apkFile: prefix + pkgName + "-" + numb + ext,
      dateInfo: r // Use the line to compare for change since it includes the date. No need to parse it out
    });
  }
  cmdRunnerModule.runCommand("/bin/bash -l -c 'adb shell ls -l /data/app/" + pkgName + "-1.apk'", function (r) {
    if (r.indexOf("No such file or directory") >= 0) {
      cmdRunnerModule.runCommand("/bin/bash -l -c 'adb shell ls -l /data/app/" + pkgName + "-2.apk'", function (r) {
        if (r.indexOf("No such file or directory") >= 0) {
          cmdRunnerModule.runCommand("/bin/bash -l -c 'adb shell ls -l /mnt/asec/" + pkgName + "-1/pkg.apk'", function (r) {
            if (r.indexOf("No such file or directory") >= 0) {
              cmdRunnerModule.runCommand("/bin/bash -l -c 'adb shell ls -l /mnt/asec/" + pkgName + "-2/pkg.apk'", function (r) {
                if (r.indexOf("No such file or directory") >= 0) {
                  error_cb({description: "Couldn't find apk /data/app/" + pkgName + "-NUM.apk"});
                  return;
                }
                foundApk("/mnt/asec/", "/pkg.apk", r, 2);
              });
              return;
            }
            foundApk("/mnt/asec/", "/pkg.apk", r, 1);
          });
          return;
        }
        foundApk("/data/app/", ".apk", r, 2);
      });
      return;
    }
    foundApk("/data/app/", ".apk", r, 1);
  });
}

RemoteHost.prototype.updateSystemLibs = function RemoteHost_updateSystemLibs(cb, progress_cb) {
  var libPaths = [ "/system/lib",
                   "/system/lib/egl",
                   "/system/lib/hw",
                   "/system/vendor/lib",
                   "/system/vendor/lib/egl",
                   "/system/vendor/lib/hw",
                   "/system/b2g" ]; 

  var pathsToList = libPaths.join("/* ");
  pathsToList += "/*";

  var self = this;
  cmdRunnerModule.runCommand("/bin/bash -l -c 'adb shell ls -d " + pathsToList + "'", function (r) {
    var lines = r.split("\n");
    var libsToPull = [];
    for (var i = 0; i < lines.length; i++) {
      lines[i] = lines[i].trim();
      if (lines[i].endsWith(".so")) {
        libsToPull.push(lines[i]);
      }
    }

    var libCacheFolder = self._systemLibCache + "/" + self._serial;
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
      let lastLib = i + 1 == libsToPull.length;
      let progressString = "Pulled " + libName + " (" + i + "/" + (libsToPull.length-1) + ")";
      cmdRunnerModule.runCommand("/bin/bash -l -c 'ls " + destLib + " || adb pull " + srcLib + " " + destLib + "'", function (r) {
        progress_cb({description: progressString});
        if (lastLib) {
          cb();
        }
      });
    }
  });
};

RemoteHost.prototype.updateApk = function RemoteHost_updateApk(srcApk, cb) {
  var libCacheFolder = this._fennecLibCache + "/" + this._serial;
  var destApk = libCacheFolder + "/symbol.apk";
  var destApkDateInfo = destApk + ".dateInfo";

  cmdRunnerModule.runCommand("/bin/bash -l -c 'cat " + destApkDateInfo + " && adb shell ls -l " + srcApk + "'", function (r) {
    var lines = r.split("\n");
    if (lines.length == 2 || lines.length == 3) {
      if (lines[0] == lines[1] && lines[0].indexOf("org.mozilla") != -1) {
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
    self.findApk(pkgName, function (apkInfo) {
      var dateInfo = apkInfo.dateInfo;
      self.updateApk(apkInfo.apkFile, function() {
        self.updateSystemLibs(function () {
          cb();
        }, progress_cb);
      });
    }, error_cb);
  });
}

RemoteHost.prototype.forwardPort = function RemoteHost_forwardPort(port, remotePort, cb, error_cb) {
  cmdRunnerModule.runCommand("/bin/bash -l -c '" + this._adbCommand + " forward tcp:" + port + " tcp:" + remotePort + " 2>&1'", function (r) {
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
