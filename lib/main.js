/* -*- Mode: js2; indent-tabs-mode: nil; js2-basic-offset: 2; -*- */
/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Initial Developer of the Original Code is
 * Mozilla Foundation.
 * Portions created by the Initial Developer are Copyright (C) 2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Benoit Girard <bgirard@mozilla.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

const {Cc,Ci,Cu} = require("chrome");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/AddonManager.jsm");

//var FORCE_DEBUG = true;
var FORCE_DEBUG = false;

// Change in SymbolicateModule.jsm
const DEFAULT_SYMBOLICATION_URL = "http://symbolapi.mozilla.org/";
//var DEFAULT_UI_URL = "http://ehsan.github.com/cleopatra/";
var OLD_UI_URL = "http://varium.fantasytalesonline.com/cleopatra/";
var OLD_UI_URL2 = "file:///Users/bgirard/ben/sps/cleopatra/index.html";
var DEFAULT_UI_URL = "http://people.mozilla.com/~bgirard/cleopatra/";
//var DEFAULT_UI_URL = "file:///home/vladimir/proj/profiler/cleopatra/index.html";
//var DEFAULT_UI_URL = "file:///Users/bgirard/ben/sps/cleopatra/index.html";
//var DEFAULT_UI_URL = "http://localhost/~markus/cleopatra/";
var DEFAULT_ANDROID_LIBS_PATH = "/tmp";
var DEFAULT_ANDROID_FENNEC_LIBS_PATH = "/tmp";

//let perf_tests = require("perf_tests/harness");
let remote = require("remote");
let prefs = require("prefs");
let data = require("self").data;
let clipboard = require("clipboard");
let timers = require("timers");
let file = require("file");
let tabs;
let gcli_binding;

let gProfileStartEpoch = null;

// For Thunderbird the tabs module is not supported, and will throw if we try
// to import it 
if (!require("api-utils/xul-app").is("Thunderbird")) {
  tabs = require("tabs");
  gcli_binding = require("gcli_binding");
}

let Request = require("request").Request;

let symbolicateModule = Cu.import(data.url("SymbolicateModule.jsm"));
let cmdRunnerModule = Cu.import(data.url("CmdRunner.jsm"));

let appWrapper = null;
var profiler = null;
var profilerFeatures = [];
var featuresToUse = [];
var startedWithFeatures = [];
var spsWidget = null;
var panel = null;
var c = 0;
var settingsTab = null;
var settingsTabPort = null;
var savedProfileLastStop = null;

var gCurrentAndroidHWID = null;

String.prototype.endsWith = function(suffix) {
      return this.indexOf(suffix, this.length - suffix.length) !== -1;
};

function DEBUGLOG(str) {
  if (FORCE_DEBUG || prefs.get_pref_bool("profiler.", "debug")) {
    if (typeof str === "string") {
      dump(str);
    } else {
      dump(JSON.stringify(str));
    }
    dump("\n");
  }
}

// add hotkey
const { XulKey } = require("xulkeys");
XulKey({
  id: "RR:DumpProfile",
  modifiers: "accel shift",
  key: "O",
  onCommand: function() {
    //perf_tests.run_all_tests();
    appWrapper.open_cleopatra();
  }
});

XulKey({
  id: "RR:ToggleProfiler",
  modifiers: "accel shift",
  key: "S",
  onCommand: function() {
    if (profiler.IsActive()) {
      stop_profiler();
    } else {
      sps_startup(true);
    }
    appWrapper.sps_update_status();
  }
});

function GCStats() {
  this._gcEvents = [];
  this._ccEvents = [];

  var want_feature_gc = prefs.get_pref_bool("profiler.", "gc", true);

  if (!want_feature_gc)
    return;

  prefs.set_pref_bool("javascript.options.mem.", "notify", true);

  var self = this;
  function receiveGCStat(subject, data) {
    var parsedEvent = JSON.parse(data);
    if (!parsedEvent.slices) {
      dump("Ignoring GC stats since it doesn't contain slice data\n");
      return;
    }
    // Convert to milliseconds and normalize to start of profiling
    parsedEvent.timestamp = parsedEvent.timestamp / 1000 - gProfileStartEpoch;
    for (var i = 0; i < parsedEvent.slices.length; i++) {
      if (!parsedEvent.slices[i].start_timestamp)
        continue;
      parsedEvent.slices[i].start_timestamp = parsedEvent.slices[i].start_timestamp / 1000 - gProfileStartEpoch;
      parsedEvent.slices[i].end_timestamp = parsedEvent.slices[i].end_timestamp / 1000 - gProfileStartEpoch;
    }
    self.addGC(parsedEvent);
  }
  function receiveCCStat(subject, data) {
    var parsedEvent = JSON.parse(data);
    // Convert to milliseconds and normalize to start of profiling
    parsedEvent.timestamp = parsedEvent.timestamp / 1000 - gProfileStartEpoch;
    parsedEvent.start_timestamp = parsedEvent.timestamp - parsedEvent.duration;
    parsedEvent.end_timestamp = parsedEvent.timestamp;
    self.addCC(parsedEvent);
  }

  var obService = require("observer-service");
  if (obService) {
    obService.add("garbage-collection-statistics", receiveGCStat, this);
    obService.add("cycle-collection-statistics", receiveCCStat, this);
  } else {
    dump("Failed to get observer-service\n");
  }
}
GCStats.prototype = {
  shutdown: function GCStats_shutdown() {
    prefs.set_pref_bool("javascript.options.mem.", "notify", false);
  },
  clear: function GCStats_clear() {
    this._gcEvents = [];
    this._ccEvents = []; 
  },
  addGC: function GCStats_addGC(gcEvent) {
    this._gcEvents.push(gcEvent);
    if (this._gcEvents.length > 200) {
      this._gcEvents.shift();
    }
  },
  addCC: function GCStats_addCC(ccEvent) {
    this._ccEvents.push(ccEvent);
    if (this._ccEvents.length > 200) {
      this._ccEvents.shift();
    }
  },
  getData: function GCStats_getData() {
    return {
      gcEvents: this._gcEvents,
      ccEvents: this._ccEvents,
    };
  },
};
var gGCStats = new GCStats();

function get_feature_pref() {
    var featurePrefs = {};
    for (var i = 0; i < profilerFeatures.length; i++) {
        var feature = profilerFeatures[i];
        featurePrefs[feature] = prefs.get_pref_bool("profiler.", feature);
    }
    return featurePrefs;
}

function has_stackwalk() {
    var hh = Cc["@mozilla.org/network/protocol;1?name=http"].getService(Ci.nsIHttpProtocolHandler);
    var platform = hh["platform"];
    if (platform === "X11") {
        platform = "Linux";
    }
    return platform === "Macintosh" || platform === "Windows";
}
function has_feature(feature) {
    if (feature == "stackwalk" && !has_stackwalk())
        return false;
    return profilerFeatures.indexOf(feature) !== -1;
}

function asyncMap(array, perElementCallback, finishCallback) {
  var len = array.length;
  var i = 0;
  var newArray = [];
  function processOneElementOrFinish() {
    perElementCallback(array[i], function (transformedElement) {
      newArray[i] = transformedElement;
      i++;
      if (i < len)
        processOneElementOrFinish()
      else
        finishCallback(newArray);
    });
  }
  processOneElementOrFinish();
}

function getAnyPrivilegedDocument() {
  // XXX HACK
  var browser = Services.wm.getMostRecentWindow(null);
  return browser.document;
}

function getIconAsDataURL(iconURL, dataURLCallback) {
  if (!iconURL) {
    dataURLCallback("");
    return;
  }

  var document = getAnyPrivilegedDocument();
  var img = document.createElementNS("http://www.w3.org/1999/xhtml","img");
  img.src = iconURL;
  img.onload = function () {
    var canvas = document.createElementNS("http://www.w3.org/1999/xhtml","canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    var ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    dataURLCallback(canvas.toDataURL("image/png"));
  }
  img.onerror = function () {
    dataURLCallback("");
  }
}

function getAddonInfo(addons, addonInfoCallback) {
  var activeAddons = addons.filter(function (addon) {
    return addon.isActive;
  });
  asyncMap(activeAddons, function (addon, mapCallback) {
    getIconAsDataURL(addon.iconURL, function (iconDataURL) {
      mapCallback({
        id: addon.id,
        name: addon.name,
        iconURL: iconDataURL,
        creator: addon.creator
      });
    });
  }, function (addonInfo) {
    addonInfoCallback(addonInfo);
  });
}

function stop_profiler(isPrivate, forceCache, save_callback) {
  if (isPrivate != true && prefs.get_pref_bool("profiler.", "copyProfileOnStop", true) ||
      isPrivate != true && forceCache == true) {
    DEBUGLOG("Copying profile on Stop");
    var profile = null;
    profile = profiler.getProfileData();
    profile.meta = profile.meta || {};
    profile.meta.addons = [];
    profile.meta.gcStats = gGCStats.getData();
    AddonManager.getAllAddons(function getAddons(addons) {
      getAddonInfo(addons, function (addonInfo) {
        profile.meta.addons = addonInfo;
        try {
          savedProfileLastStop = profile;
          DEBUGLOG("Stop profiler");
          profiler.StopProfiler();
          gGCStats.clear();
          appWrapper.sps_update_status();
          if (save_callback) save_callback(profile);
        } catch (e) {
          dump("Profiler Exception: " + JSON.stringify(e));
        }
      });
    });
  } else {
    DEBUGLOG("Stop profiler");
    profiler.StopProfiler();
    gGCStats.clear();
    appWrapper.sps_update_status();
    if (save_callback) save_callback();
  }
}

function sps_startup(force, manifest) {
    if (appWrapper.pb && appWrapper.pb.isActive) {
      dump("Can't start the profiler in private browsing\n");
      return;
    }

    manifest = manifest || {};

    prefs.default_init_pref("profiler.", "stackwalk", true);
    prefs.default_init_pref("profiler.", "jank", false);
    prefs.default_init_pref("profiler.", "adb", true);
    prefs.default_init_pref("profiler.", "js", true);
    prefs.default_init_pref("profiler.", "gc", true);
    prefs.default_init_pref("profiler.", "debug", false);
    prefs.default_init_pref("profiler.", "copyProfileOnStop", true);
    prefs.default_init_pref_string("profiler.", "symbolicationUrl", DEFAULT_SYMBOLICATION_URL);
    prefs.default_init_pref_string("profiler.", "url", DEFAULT_UI_URL);
    prefs.default_init_pref_string("profiler.", "androidLibsHostPath", DEFAULT_ANDROID_LIBS_PATH);
    prefs.default_init_pref_string("profiler.", "fennecLibsHostPath", DEFAULT_ANDROID_FENNEC_LIBS_PATH);

    var settingsVersion = prefs.get_pref_int("profiler.", "version", 0);
    if (settingsVersion == 0) {
      prefs.set_pref_int("profiler.", "version", 1);
    }
    if (settingsVersion < 2) {
      prefs.set_pref_bool("profiler.", "debug", false);
      prefs.set_pref_int("profiler.", "version", 2);
    }
    if (settingsVersion < 3) {
      // Force people to new settings including high resolution and stackwalk if supported
      // people are struggling to find these settings so lets help them.
      prefs.set_pref_bool("profiler.", "stackwalk", true);
      prefs.set_pref_int("profiler.", "entries", 1000000);
      prefs.set_pref_int("profiler.", "interval", 1);
      prefs.set_pref_int("profiler.", "version", 3);
    }


    if (get_ui_url() == OLD_UI_URL || get_ui_url() == OLD_UI_URL2) {
        prefs.set_pref_string("profiler.", "url", DEFAULT_UI_URL);
    }

    if (prefs.get_pref_bool("profiler.", "enabled") || force == true) {
        var features = profilerFeatures;
        var entries = prefs.get_pref_int("profiler.", "entries");
        var interval = prefs.get_pref_int("profiler.", "interval");
        var want_feature_js = prefs.get_pref_bool("profiler.", "js", true);
        var want_feature_gc = prefs.get_pref_bool("profiler.", "gc", true);
        var want_feature_stackwalk = prefs.get_pref_bool("profiler.", "stackwalk", true);
        var want_feature_jank = prefs.get_pref_bool("profiler.", "jank", false);
        var want_feature_adb = prefs.get_pref_bool("profiler.", "adb", false);
        var wants_feature_copy_on_save = prefs.get_pref_bool("profiler.", "copyProfileOnStop", true);

        if (manifest.defaultTestSettings) {
          entries = 1000000;
          interval = 1;
          want_feature_js = true;
          want_feature_stackwalk = true;
          want_feature_adb = true;
          wants_feature_copy_on_save = false;
        }

        // Make sure we have enough entries to get results back
        entries = Math.max(1000, entries);
        
        var selectedFeatures = [];
        if (has_feature("js") && want_feature_js) {
            selectedFeatures.push("js");
        }
        if (want_feature_gc) {
            selectedFeatures.push("gc");
        }
        if (has_feature("stackwalk") && want_feature_stackwalk) {
            selectedFeatures.push("stackwalk");
        }
        if (has_feature("jank") && want_feature_jank) {
            selectedFeatures.push("jank");
        }
        if (has_feature("adb") && want_feature_adb) {
            selectedFeatures.push("adb");
        }
        if (wants_feature_copy_on_save) {
            selectedFeatures.push("copyProfileOnStop");
        }
        savedProfileLastStop = null; 
        DEBUGLOG("Start profiling with options:");
        DEBUGLOG(selectedFeatures);
        gProfileStartEpoch = new Date().getTime();
        profiler.StartProfiler(entries, interval, selectedFeatures, selectedFeatures.length);
        startedWithFeatures = selectedFeatures;
        appWrapper.registerConsoleProfilerObserver();
        appWrapper.sps_update_status();
        if (gcli_binding && appWrapper.get_profiler_status) {
            gcli_binding.bindGCLI(profiler, appWrapper.get_profiler_status(), toggle_state, set_feature, analyze);
        }
    }
}

function store_profile(callback) {
    get_profile(null, function(profile) {
        var storeRequest = Request({
          url: "http://profile-logs.appspot.com/store",
          content: {"file": profile},
          onComplete: function (response) {
            //for (var headerName in response.headers) {
            //    console.log(headerName + " : " + response.headers[headerName]);
            //}
            //console.log("Status text: " + response.text);
            
            // We can't get the redirect so for now we cheat
            // we need to modify the store to give the redirect url
            // in the response.
            var url = get_ui_url() + "?report=" + response.text;
            console.log("Upload profile to: " + url);
            callback(url);
          }
        }).post();
    });
}

function get_profile(progress_callback, finish_callback) {
    
    if (progress_callback != null) {
        progress_callback({progress: 0, action: "Retrieving profile"});
    }
    DEBUGLOG("Get profile");
    timers.setTimeout(function() {
        function send_profile(profile) {
            if (FORCE_DEBUG || prefs.get_pref_bool("profiler.", "debug")) {
              DEBUGLOG("PROFILERDEBUG: " + JSON.stringify(profile));
            }
            if (profile == null) {
                progress_callback({progress: 1, action: "Empty profile"});
                return;
            }
            var sharedLibraries = profiler.getSharedLibraryInformation();
            symbolicateModule.symbolicate(profile, null, sharedLibraries,
                                      progress_callback,
                                      finish_callback);
        } 

        var profile;
        if (profiler.IsActive() == false && savedProfileLastStop != null) {
            DEBUGLOG("Using last profile");
            profile = savedProfileLastStop;
            send_profile(profile);
        } else {
            DEBUGLOG("get json profile");
            profile = profiler.getProfileData();
            DEBUGLOG("got json profile");
            profile.meta = profile.meta || {};
            profile.meta.addons = [];
            AddonManager.getAllAddons(function getAddons(addons) {
                DEBUGLOG("got extensions");
                getAddonInfo(addons, function (addonInfo) {
                    profile.meta.addons = addonInfo;
                    profile.meta.gcStats = gGCStats.getData();
                    try {
                        send_profile(profile);
                    } catch (e) {
                        dump("Profiler Exception: " + JSON.stringify(e));
                    }
                });
            });
        }
    }, 0);
    return;
}

function adb_get_hwid(callback) {
    cmdRunnerModule.runCommand("/bin/bash -l -c 'adb devices'", function(r) {
        var connectedDevices = [];
        var lines = r.split("\n");
        for (var i = 0; i < lines.length; ++i) {
            var line = lines[i].trim().split(/\W+/);
            if (line.length < 2 || line[1] != "device")
                continue;
            connectedDevices.push(line[0]);
        }

        if (connectedDevices.length == 0) {
            callback(null);
            return;
        }

        if (connectedDevices.length != 1) {
            callback(null);
            return;
        }

        var hwid = connectedDevices[0];
        callback(hwid);
    });
}

function importPackage(fileName, progress_callback, finish_callback) {
    dump("Importing: " + fileName + "\n");
    cmdRunnerModule.runCommand("/bin/bash -l -c 'unzip -o " + fileName + " -d /tmp; unzip -o /tmp/symbol.apk -d /tmp; cp /tmp/lib/armeabi-v7a/* /tmp/'", function() {
        cmdRunnerModule.runCommand("/bin/cat /tmp/fennec_profile.txt", function (r) {
            dump("Got raw profile: " + r.length + "\n");
            progress_callback({progress: 0.7, action: "Parsing"});
            symbolicateModule.symbolicate(r, "Android", null, progress_callback, finish_callback, null);
        });
    });
}

function adb_pull_libs(progress_callback, finish_callback) {
    var pathPrefix = prefs.get_pref_string("profiler.", "androidLibsHostPath");

    // paths to pull
    var libPaths = [ "/system/lib",
                     "/system/lib/egl",
                     "/system/lib/hw",
                     "/system/vendor/lib",
                     "/system/vendor/lib/egl",
                     "/system/vendor/lib/hw",
                     "/system/b2g" ];

    var pullLibs = function(libPath, destDirBasePath, libsList) {
        var lines = libsList.split("\n");
        var libsToPull = [];
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (line.endsWith(".so") == false) continue;
            libsToPull.push(line);
        }
        var total = libsToPull.length;

        var libsPulled = 0;
        for (var i = 0; i < total; i++) {
            let libName = libsToPull[i];
            let srcPath = libPath + "/" + libName;

            // this is horrid, but will get the job done; we have to split on "/" so that we can
            // get the OS-native path separators later
            var pathArg = libPath.substr(1).split("/");
            // then we stick the destDirBasePath at the front, and use join.apply() to get the final path
            pathArg.splice(0, 0, destDirBasePath);
            let dstPath = file.join.apply(null, pathArg);

            file.mkpath(dstPath);

            if (file.exists(file.join(dstPath, libName))) {
                progress_callback({progress: libsPulled/total, action: "Skipped already existing library: " + libName});
                libsPulled++;
                continue;
            }

            cmdRunnerModule.runCommand("/bin/bash -l -c 'adb pull " + srcPath + " " + dstPath + "'", function(r) {
                libsPulled++;

                progress_callback({progress: libsPulled/total, action: "Pulled Device library: " + libName});
                dump("Pulled Device library: " + libName + " -> " + dstPath + "\n");

                if (libsPulled == total) {
                    progress_callback({progress: 0, action: "Got all libraries"});
                }
            });
        }

        // in case we skipped everything
        if (libsPulled == total) {
            progress_callback({progress: 0, action: "Got all libraries"});
        }
    };

    adb_get_hwid(function(hwid) {
        if (hwid == null)
            return;

        var baseDirPath = file.join(pathPrefix, hwid);
        file.mkpath(baseDirPath);

        dump("HWID " + hwid + "\n");

        for (var i = 0; i < libPaths.length; ++i) {
            var libPath = libPaths[i];
            
            // grab the list of files in this libPath, and process them
            cmdRunnerModule.runCommand("/bin/bash -l -c 'adb shell ls " + libPath + "'", (function(xLibPath) { return function(r) {
                pullLibs(xLibPath, baseDirPath, r);
            }; })(libPath));
        }
    });
}

function adb_get_process_info(finish_callback) {
    cmdRunnerModule.runCommand("/bin/bash -l -c 'adb shell ps'", function(r) {
        var lines = r.split("\n");
        var processLine = null;
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (line.indexOf("org.mozilla.fennec") != -1) {
                processLine = line;
                break;
            }
            if (line.indexOf("/system/b2g/b2g") != -1) {
                processLine = line;
                break;
            }
        }
        if (processLine == null) {
            finish_callback({error: "B2G/Fennec is not running."});
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
            finish_callback({error: "Could not find PID in: " + processLine});
            return;
        }

        var runAs;
        var launchCmd;
        var startProfilingCmd;
        var stopProfilingCmd;
        var savePath;
        if (pkgName.indexOf("/system/b2g/b2g") != -1) {
            runAs = "";
            startProfilingCmd = "adb shell kill -31 " + pid;
            stopProfilingCmd = "adb shell kill -12 " + pid;
            launchCmd = "adb shell stop b2g && adb shell MOZ_PROFILER_STARTUP=true /system/bin/b2g.sh > /dev/null &";
            savePath = "/data/local/tmp";
        } else if (pkgName.indexOf("org.mozilla") != -1) {
            var runAsTail = "";
            // if we're trying to profile a nightly, official, or aurora build, then we try to do it as root
            if (pkgName == "org.mozilla.fennec" || pkgName == "org.mozilla.firefox" || pkgName == "org.mozilla.aurora") {
              runAs = "su -c \"";
              runAsTail = "\"";
            } else {
              runAs = "run-as " + pkgName;
            }
            startProfilingCmd = "adb shell " + runAs + " kill -31 " + pid + runAsTail;
            stopProfilingCmd = "adb shell " + runAs + " kill -12 " + pid + runAsTail;
            launchCmd = "adb shell am start -n " + pkgName + "/.App --es env0 MOZ_PROFILER_STARTUP=true";
            savePath = "/data/data/" + pkgName +"/app_tmp";
        } else {
            finish_callback({error: "Could not find package name: " + pkgName});
            return;
        }
        
        finish_callback({ pid: pid,
                          pkgName: pkgName,
                          runAs: runAs,
                          startProfilingCmd: startProfilingCmd,
                          stopProfilingCmd: stopProfilingCmd,
                          launchCmd: launchCmd,
                          savePath: savePath });
    });
}

/*
This feature should be moved to work within the cleopatra UI
function bugzilla_file_bug() {
    store_profile(bugzilla_file_bug_with_profile);
}

function bugzilla_file_bug_with_profile(url) {
    var onlyOnce = true;
    tabs.open({
        url: "https://bugzilla.mozilla.org/enter_bug.cgi?product=Core",
        onReady: function onReady(tab) {
            if (!onlyOnce) {
              return;
            }
            onlyOnce = false;
            var attach = tab.attach({
                contentScriptFile:
                    data.url("bugzilla.js")
            });
            attach.port.on("getaboutsupport", function(text) {
            
                var info = { 
                    "appname" : Services.appinfo.name,
                    "os" : Services.appinfo.OS,
                    "XPCOMABI" : Services.appinfo.XPCOMABI,
                    "toolkit" : Services.appinfo.toolkit,
                };
                
                var hh = Cc["@mozilla.org/network/protocol;1?name=http"].getService(Ci.nsIHttpProtocolHandler);
                for each (var prop in [ "userAgent", "appName", "appVersion",
                             "vendor", "vendorSub",
                             "product", "productSub",
                             "platform", "oscpu", "language", "misc" ]) {
                    info[prop] = hh[prop];
                };
                var data = {
                    "url" : url,
                    "info" : info,
                };
                attach.port.emit("getaboutsupport", data);
            });
        }
    });
}
*/

function get_ui_url() {
    return prefs.get_pref_string("profiler.", "url", DEFAULT_UI_URL);
}

function open_settings() {
    if (settingsTab) {
      settingsTab.activate();
      return;
    }
    
    var onlyOnce = true;
    tabs.open({
        url: data.url("settings.html"),
        onReady: function onReady(tab) {
            if (!onlyOnce) {
              return;
            }
            settingsTab = tab;
            onlyOnce = false;
            var attach = tab.attach({
                contentScriptFile:
                    data.url("settings.js")
            });
            attach.port.on("adjust_sampling", function(obj) {
              prefs.set_pref_int("profiler.", "interval", obj.interval);
              prefs.set_pref_int("profiler.", "entries", obj.entries);
              if (profiler.IsActive()) {
                stop_profiler();
                sps_startup(true);
              }
              appWrapper.sps_update_status();
            });
            attach.port.on("set_feature", function(obj) {
                prefs.set_pref_bool("profiler.", obj.feature, obj.value);
                appWrapper.sps_update_status();

                if (obj.feature === "gc") {
                  prefs.set_pref_bool("javascript.options.mem.", "notify", obj.value);
                }
            });
            settingsTabPort = attach;
            appWrapper.sps_update_status();
        },
        onClose: function close() {
            settingsTabPort = null;
            settingsTab = null;
        },
    });
}


let ThunderbirdAppWrapper = {
  _toggle: null,
  _dumpButton: null,

  init: function tb_init() {
    console.log("tb_init entered.");
    try {
      profiler = Cc["@mozilla.org/tools/profiler;1"].getService(Ci.nsIProfiler);
    } catch(e) {
      console.error("Profiler module not found.");
    }

    try {
        profilerFeatures = profiler.GetFeatures([]);
        // Add-on side feature
        profilerFeatures.push("adb");
    } catch(e) { }

    let doc = Services.wm.getMostRecentWindow('mail:3pane').document;
    let statusBar = doc.getElementById('status-bar');

    this._dumpButton = doc.createElementNS(
      'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul',
      'statusbarpanel');

    this._toggle = this._dumpButton.cloneNode();
    this._toggle.setAttribute('id', 'toggleProfiler');
    this._toggle.addEventListener('click', function(aEvent) {
      if (profiler.IsActive())
        this._set_sps_enabled(false);
      else
        this._set_sps_enabled(true);

    }.bind(this));

    statusBar.appendChild(this._toggle);

    this._dumpButton.setAttribute('label', 'Dump Profile');
    this._dumpButton.setAttribute('image',
                                  'chrome://global/skin/icons/loading_16.png');
    this._dumpButton.setAttribute('id', 'dumpProfile');
    this._dumpButton.addEventListener('click', function(aEvent) {
      if (profiler.IsActive())
        this.open_cleopatra();
    }.bind(this));

    statusBar.appendChild(this._dumpButton);

    this.sps_update_status();
    console.log("tb_init exited.");
  },

  shutdown: function tb_shutdown() {
    gGCStats.shutdown();

    // If the profiler is enabled, disable it
    this._set_sps_enabled(false);

    let toRemove = ['_dumpButton', '_toggle'];

    for each (let [, aNodeKey] in Iterator(toRemove)) {
      let node = this[aNodeKey];
      if (node.parentNode)
        node.parentNode.removeChild(node);
      this[aNodeKey] = null;
    };
  },

  sps_update_status: function tb_sps_update_status() {
    let toggleLabel = profiler.IsActive() ? "Enabled" : "Disabled";
    let toggleStyle = profiler.IsActive() ? "#00611C" : "#551011";

    this._toggle.setAttribute('label', toggleLabel);
    this._toggle.style.color = toggleStyle;
  },

  open_cleopatra: function tb_open_cleopatra(aProfileType, args) {
    if (aProfileType == null)
        aProfileType = 'desktop';

    // We append a timestamp because we want a new tab each time we dump the
    // profile. If we don't do this, Thunderbird tries to refocus the old tab.
    let front_end_url = get_ui_url() + "?" + Date.now();
    let self = this;

    // Get the most recent 3pane
    try {
      this._is_spinning(true);

      let tabmail = this._get_most_recent_tabmail();

      console.log("About to open up the contentTab");
      let tab = tabmail.openTab('contentTab', {
        contentPage: front_end_url,
      });

      if (!tab)
        throw new Error('Could not open the Cleopatra tab.');

      // Once the tab is open and loaded, go and get the profile, posting
      // messages to the window to let it know how we're doing.
      tab.browser.addEventListener('DOMContentLoaded', function(aEvent) {

        tab.browser.removeEventListener('DOMContentLoaded',
                                        arguments.callee,
                                        true);

        let win = tab.browser.contentWindow;
        win.postMessage(JSON.stringify({
          task: "importFromAddonStart",
        }), "*");

        console.log('Fetching profile.');

        get_profile(
          function(aMsg) {
            win.postMessage(JSON.stringify({
              task: "importFromAddonProgress",
              progress: aMsg.progress,
              action: aMsg.action
            }), "*");
          },
          function(aProfile) {
            console.log('Completed getting profile');
            self._is_spinning(false);
            win.postMessage(JSON.stringify({
              task: "importFromAddonFinish",
              rawProfile: aProfile
            }), "*");
          }
        );
      }, true);

    } catch(e) {
      console.error(e);
    }

  },

  _get_most_recent_tabmail: function tb__get_most_recent_tabmail() {
    let mail3pane = Services.wm.getMostRecentWindow('mail:3pane');

    if (!mail3pane)
      throw new Error('Could not find a 3pane to open cleopatra in.');

    let tabmail = mail3pane.document.getElementById('tabmail');

    if (!tabmail)
      throw new Error('Could not find a tabmail in the 3pane!');

    return tabmail;
  },

  _set_sps_enabled: function tb__set_sps_enabled(aEnable) {
    // If the profiler is already in the state we want it to be in, bail.
    if (aEnable == profiler.IsActive())
      return;

    if (!aEnable) {
      stop_profiler();
      this.sps_update_status();
    }
    else {
      // Currently, sps_startup calls sps_update_status automatically.
      sps_startup(true);
    }
  },

  registerConsoleProfilerObserver: function tb_ob() {
    // This shouldn't be required for TB
  },

  _is_spinning: function tb__is_spinning(aSpinning) {
    console.log("Setting spinning to: " + aSpinning);
    if (aSpinning)
      this._dumpButton.classList.add('statusbarpanel-iconic');
    else
      this._dumpButton.classList.remove('statusbarpanel-iconic');

    console.log("Done!");
  },
};

function run_call_sequence(calls_array, progress_callback, finish_callback, error_callback) {
  var do_next_call = function(result, i) {
    if (calls_array.length <= i)
      return;

    console.log("Calling op " + i);
    //progress_callback({progress: 0, action: "calling op " + i});
    var op = calls_array[i];

    var keepGoing = true;
    var next_call = function(r) { if (keepGoing) do_next_call(r, i+1); };
    var commandToRun = null;

    if (typeof(op) == "string") {
      commandToRun = op;
    } else if (typeof(op) == "function") {
      var r = calls_array[i].call(null,
                                  result,
                                  next_call);
      console.log("op result: " + r);
      if (typeof(r) == "string") {
        commandToRun = r;
      } else if (typeof(r) == "object") {
        if (typeof(r[0]) == "string") {
          commandToRun = r[0];
        }
        keepGoing = r[1];
      }
    } else {
      throw "Invalid op type " + typeof(op);
    }

    if (commandToRun != null) {
      console.log("CommandToRun is: " + commandToRun);
      if (commandToRun.indexOf("/bin/bash") == -1) {
        commandToRun = "/bin/bash -l -c '" + commandToRun + "'";
      }

      cmdRunnerModule.runCommand(commandToRun, function(cmd_result) {
        result.cmd_result = cmd_result;
        next_call(result);
      });
    }
  };

  var data = {
    progress_callback: progress_callback || function() { },
    finish_callback: finish_callback || function() { },
    error_callback: error_callback || function(r) { throw r; }
  };

  do_next_call(data, 0, error_callback);
 }

function adb_check_fn(data, next_call) {
  var result = data.cmd_result;

  if (result.indexOf("Android Debug Bridge") != 0) {
    data.progress_callback({progress: 0, action: "Could not find 'adb', make sure it is in your PATH"});
    return;
  }

  next_call(data);
}


// fills in data.process_info
function adb_get_process_info_fn(data, next_call) {
  adb_get_process_info(function(pinfo) {
    data.process_info = pinfo;
    if (pinfo.error == null) {
      data.last_seen_pkgName = pinfo.pkgName;
      data.last_seen_launchCmd = pinfo.launchCmd;
    }
    next_call(data);
  });
}

// fills in data.hwid
function adb_get_hwid_fn(data, next_call) {
  cmdRunnerModule.runCommand("/bin/bash -l -c 'adb devices'", function(r) {
    var connectedDevices = [];
    var lines = r.split("\n");
    for (var i = 0; i < lines.length; ++i) {
      var line = lines[i].trim().split(/\W+/);
      if (line.length < 2 || line[1] != "device")
        continue;
      connectedDevices.push(line[0]);
    }

    if (connectedDevices.length == 0) {
      data.error_callback("adb failed -- might not be in your path, or no devices attached");
      return;
    }

    if (connectedDevices.length != 1) {
      data.error_callback("more than one hwid attached for adb; specify it explicitly via prefs or env var");
      return;
    }

    data.hwid = connectedDevices[0];
    next_call(data);
  });
}

// expects data.process_info, calls startProfilingCmd
function adb_send_start_profiling_fn(data, next_call) {
  if (data.process_info.error) {
    var err = data.process_info ? data.process_info.error : "null process_info";
    data.progress_callback({progress: 0, action: "Error getting process info: " + err});
    return;
  }

  return data.process_info.startProfilingCmd;
}

// expects data.process_info, calls stopProfilingCmd
function adb_send_stop_profiling_fn(data, next_call) {
  if (data.process_info.error) {
    var err = data.process_info ? data.process_info.error : "null process_info";
    data.progress_callback({progress: 0, action: "Error getting process info: " + err});
    return;
  }

  return data.process_info.stopProfilingCmd;
}

// expects data.process_info and data.last_seen_launchCmd from a previously
// successful process_info query
function adb_launch_with_profiling_if_not_running_fn(data, next_call) {
  if (data.process_info.error != null) {
    data.progress_callback({progress: 0, action: "Launching with profiling enabled..."});
    if (!data.last_seen_launchCmd) {
      data.progress_callback({progress: 0, action: "Don't know how to launch!"});
    }

    return [data.last_seen_launchCmd, false];
  }

  next_call(data);
}

function adb_wait_for_save_fn(data, next_call) {
  data.progress_callback({progress: 0.3, action: "Waiting for save..."});
  timers.setTimeout(function() { next_call(data); },
                    3000);
}

// expects data.process_info
function adb_pull_profile_fn(data, next_call) {
  var processInfo = data.process_info;

  data.progress_callback({progress: 0.4, action: "Pulling profile..."});
  return "adb pull " + processInfo.savePath + "/profile_0_" + processInfo.pid + ".txt /tmp/fennec_profile.txt || " +
    "adb pull /sdcard/profile_0_" + processInfo.pid + ".txt /tmp/fennec_profile.txt";
}

// expects data.process_info
function adb_pull_fennec_libs_fn(data, next_call) {
  var fennecPathPrefix = prefs.get_pref_string("profiler.", "fennecLibsHostPath");
  var processInfo = data.process_info;

  // try to fetch pkgname-1.apk or pkgname-2.apk as /tmp/symbol.apk, and then unpack it
  data.progress_callback({progress: 0.5, action: "Pulling Fennec libs..."});
  return "rm -f /tmp/symbol.apk; " +
    "adb pull /data/app/" + processInfo.pkgName + "-1.apk /tmp/symbol.apk || " + 
    "adb pull /data/app/" + processInfo.pkgName + "-2.apk /tmp/symbol.apk; " +
    "unzip -o /tmp/symbol.apk -d \"" + fennecPathPrefix + "\"; " + 
    "cp \"" + fennecPathPrefix + "\"/lib/armeabi-v7a/libmozglue.so \"" + fennecPathPrefix + "\"";
}

// doesn't quite work
function adb_read_profile_via_gzip_fn(data, next_call) {
  var processInfo = data.process_info;
  
  var paths = [
    processInfo.savePath + "/profile_0_" + processInfo.pid + ".txt",
    "/sdcard/profile_0_" + processInfo.pid + ".txt"
  ];

  var dumpCmd = "";
  for (var i = 0; i < paths.length; ++i) {
    dumpCmd += "([ -f " + paths[i] + " ] && gzip -9 < " + paths[i] + ") || ";
  }
  dumpCmd += "false";

  dump("profile dump cmd: " + dumpCmd + "\n");

  cmdRunnerModule.runCommand("/bin/bash -l -c 'adb shell \"" + dumpCmd + "\" | gunzip -'", function (r) {
    dump("Got raw profile: " + r.length + " bytes\n");
    data.progress_callback({progress: 0.7, action: "Parsing"});
    symbolicateModule.symbolicate(r, "Android", null, data.progress_callback, data.finish_callback, data.hwid);

    next_call(data);
  });
}

function adb_read_pulled_profile_fn(data, next_call) {
  cmdRunnerModule.runCommand("/bin/cat /tmp/fennec_profile.txt", function (r) {
    dump("Got raw profile: " + r.length + " bytes\n");
    data.progress_callback({progress: 0.7, action: "Parsing"});
    symbolicateModule.symbolicate(r, "Android", null, data.progress_callback, data.finish_callback, data.hwid);

    next_call(data);
  });
}

function noop_fn(data, next_call) {
  next_call(data);
}

function adb_start(progress_callback) {
  var steps = [
    adb_get_hwid_fn,
    adb_get_process_info_fn,
    adb_send_start_profiling_fn,
    adb_get_process_info_fn,
    adb_launch_with_profiling_if_not_running_fn
  ];

  run_call_sequence(steps, progress_callback);
}

function adb_pull(progress_callback, finish_callback, skip_fennec_libs) {
  var steps = [
    adb_get_hwid_fn,
    adb_get_process_info_fn,
    adb_send_stop_profiling_fn,
    adb_get_process_info_fn,
    adb_launch_with_profiling_if_not_running_fn,
    adb_wait_for_save_fn,
    adb_pull_profile_fn,
    skip_fennec_libs ? noop_fn : adb_pull_fennec_libs_fn,
    adb_read_pulled_profile_fn
  ];

  run_call_sequence(steps, progress_callback, finish_callback);
}

function toggle_state() {
  if (profiler.IsActive()) {
      stop_profiler();
  } else {
      sps_startup(true);
  }
  appWrapper.sps_update_status();
}

function set_feature(feature, value) {
  prefs.set_pref_bool("profiler.", feature, value);

  if (feature === "gc") {
    prefs.set_pref_bool("javascript.options.mem.", "notify", value);
  }
  appWrapper.sps_update_status();
}

function analyze(callback) {
  appWrapper.open_cleopatra("desktop", null, callback);
  panel.hide();
  appWrapper.sps_update_status();
}

let FirefoxAppWrapper = {
  init: function ff_init() {
      let self = this;
      panel = require("panel").Panel({
          width:245,
          height:230,
          contentURL: data.url("sps_panel.html"),
          contentScriptFile: data.url("sps_panel.js"),
          contentScriptWhen: "ready",
          onShow: function() {
              panel.port.emit("onShow", null);
          },
          onHide: function() {
              panel.port.emit("onHide", null);  
          },
          onMessage: function() {
              return prefs.get_pref_bool("profiler.", "enabled");
          }
      });
      panel.port.on("toggle", function(text) {
          toggle_state();
      });
      // Used by the checkbox to toggle a feature
      panel.port.on("set_feature", function(obj) {
          set_feature(obj.feature, obj.value);
      });
      panel.port.on("getprofile", function(text) {
          analyze();
      });

      panel.port.on("importpackage", function(text) {
          // Example from: http://gitorious.org/addon-sdk/bugzilla-triage-scripts/blobs/master/lib/prompts.js
          var window = require("window-utils").activeWindow;
          var fp = Cc["@mozilla.org/filepicker;1"]
               .createInstance(Ci.nsIFilePicker);
          fp.init(window, "Import Gecko Profiler ZIP Package", Ci.nsIFilePicker.modeOpen);
          fp.appendFilter("Profile ZIP Package", "*.zip");
          fp.appendFilters(Ci.nsIFilePicker.filterAll);
          fp.filterIndex = 0;
          var res = fp.show();
          if (res === Ci.nsIFilePicker.returnOK
              || res === Ci.nsIFilePicker.returnReplace) {
              self.open_cleopatra("importpackage", fp.file.path);
          }
      });
      panel.port.on("adblibs", function(text) {
          self.open_cleopatra("libs");
          panel.hide();
      });
      panel.port.on("adbstart", function(text) {
          self.open_cleopatra("start");
          panel.hide();
      });
      panel.port.on("adbpull", function(obj) {
          self.open_cleopatra("adb", obj);
          panel.hide();
      });
      panel.port.on("opensettings", function(text) {
          open_settings();
          panel.hide();
      });
      panel.port.on("filebug", function(text) {
          bugzilla_file_bug();
          panel.hide();
      });
      panel.port.on("responsive", function(text) {
          if (profiler) {
              var data = profiler.GetResponsivenessTimes({});
              panel.port.emit("responsive", data);
          }
      });
      try {
        profiler = Cc["@mozilla.org/tools/profiler;1"].getService(Ci.nsIProfiler);
      } catch(e) {
          spsWidget = require("widget").Widget({
            id: "hello-display",
            label: "Built-in Profiler",
            content: "Profiler module not found.",
            width: 200,
            panel: panel
          });
          return;
      }
      try {
          profilerFeatures = profiler.GetFeatures([]);
          // Add-on side feature
          profilerFeatures.push("adb");
      } catch(e) { }

      spsWidget = require("widget").Widget({
        id: "hello-display",
        label: "Built-in Profiler",
        content: "Profiler",
        width: 200,
        panel: panel
      });

      this.pb = require("private-browsing");
      // If we stopped the profiler when entering private
      // browsing we will restart it when exiting
      this.privateBrowsingRestartProfiler = false;

      this._runningProfileSessions = {};

      sps_startup(true);
      this.sps_update_status();

      this.pb.on("start", function() {
        // Lock the extension
        DEBUGLOG("Start private browsing");
        self.privateBrowsingRestartProfiler = profiler.IsActive();
        stop_profiler(true);
        self.sps_update_status();
      });

      this.pb.on("stop", function() {
        DEBUGLOG("Stop private browsing");
        if (self.privateBrowsingRestartProfiler) {
          self.privateBrowsingRestartProfiler = false;
          sps_startup(true);
        }
        self.sps_update_status();
      });
  },

  registerConsoleProfilerObserver: function ff_ob() {
    function receiveObserverEvent(subject, data) {
      data = subject.wrappedJSObject;

      DEBUGLOG("Got event: " + data.action);

      var labelName = data.arguments[0];
      if (typeof profile !== "string") {
        labelName = "default";
      }

      if (data.action == "profile" && this._runningProfileSessions[labelName] == null) {
        if (Object.keys(this._runningProfileSessions).length === 0) {
          profiler.StopProfiler();
          gGCStats.clear();
        }
        this._runningProfileSessions[labelName] = "Running";
        if (!profiler.IsActive()) {
          sps_startup(true);
        }
      } else if (data.action == "profileEnd" && this._runningProfileSessions[labelName] != null) {
        delete this._runningProfileSessions[labelName];
        if (Object.keys(this._runningProfileSessions).length === 0) {
          // Stop the profiler right now record the least noise possible.
          stop_profiler(false, true);
          this.open_cleopatra("desktop");
        }
      }
    }
    var obService = require("observer-service");
    if (obService) {
      DEBUGLOG("Got ob service");
      obService.add("console-api-profiler", receiveObserverEvent, this);
    } else {
      dump("Failed to get observer-service\n");
    }
  },

  shutdown: function ff_shutdown() {
    gGCStats.shutdown();
  },

  get_profiler_status: function ff_profiler_status() {
      var isActive = profiler.IsActive();
      var profilerFeaturesPrefs = get_feature_pref();
      var samplingInterval = prefs.get_pref_int("profiler.", "interval");
      var sampleBufferSize = prefs.get_pref_int("profiler.", "entries");
      var runningLabel = "Start";
      var addonLabel = "Stopped";
      if (isActive) {
        runningLabel = "Stop";
        addonLabel = "Running";
      }
      if (this.pb.isActive) {
        addonLabel = "Private Browsing";
      }
      spsWidget.content = "Profiler: " + addonLabel;
      var profilerStatus = {
          profilerFeatures: profilerFeatures, 
          profilerFeaturesPrefs: profilerFeaturesPrefs,
          startedWithFeatures: startedWithFeatures, 
          runningLabel: runningLabel, 
          isActive: isActive,
          samplingInterval: samplingInterval,
          sampleBufferSize: sampleBufferSize
      };
      return profilerStatus;
  },

  sps_update_status: function ff_sps_update_status() {
      var profilerStatus = this.get_profiler_status();
      panel.port.emit("change_status", profilerStatus);
      if (settingsTabPort)
        settingsTabPort.port.emit("change_status", profilerStatus);
  },

  open_cleopatra: function ff_open_cleopatra(profileType, args, got_profile_callback) {
      if (profiler.IsActive() == false)
        return;
      if (profileType == null) {
          profileType = "desktop";
      }
      var onlyOnce = true;
      var front_end_url = get_ui_url();
      tabs.open({
          url: front_end_url,
          onReady: function onReady(tab) {
              if (!onlyOnce) {
                return;
              }
              onlyOnce = false;
              var attach = tab.attach({
                  contentScriptFile:
                      data.url("cleopatra.js")
              });
              attach.port.on("adbstart", function(text) {
                  // send a start signal
                  adb_start(function(msg){
                      attach.port.emit("getprofile_progress", msg);
                  }, function(profile){});
              });
              attach.port.on("adblibs", function(text) {
                  adb_pull_libs(function(msg) { // progress
                      attach.port.emit("getprofile_progress", msg);
                  }, function(profile) { // complete
                  });
              });
              attach.port.on("adbpull", function(obj) {
                  adb_pull(function(msg) { // progress
                      attach.port.emit("getprofile_progress", msg);
                  }, function(profile) { // complete
                      attach.port.emit("getprofile", profile);
                  }, !!obj.profileOnly);
              });
              attach.port.on("importpackage", function(fileName) {
                  importPackage(fileName, function(msg) { // progress
                      attach.port.emit("getprofile_progress", msg);
                  }, function(profile) { // complete
                      attach.port.emit("getprofile", profile);
                  });
              });
              attach.port.on("getprofile", function(text) {
                  get_profile(function(msg) { // progress
                      attach.port.emit("getprofile_progress", msg);
                  }, function(profile) { // complete
                      // Let the UI have a look at the profile, this is used to echo the profile
                      // size by the GCLI
                      if (got_profile_callback) {
                          got_profile_callback(profile);
                      }
                      attach.port.emit("getprofile", profile);
                  });
              });
              attach.port.emit("get_profile_" + profileType, args);
          }
      });
  },

};

// Thunderbird gets its own super-special initialization.

exports.main = function(aOptions, aCallbacks) {
  if (require("api-utils/xul-app").is("Thunderbird"))
    appWrapper = ThunderbirdAppWrapper;
  else
    appWrapper = FirefoxAppWrapper;

  appWrapper.init();
}

exports.onUnload = function(aReason) {
  if (appWrapper)
    appWrapper.shutdown();
  if (aReason != "shutdown") {
    // Don't stop the profiler is we are only shutting down
    // rather then upgrading or turning of the extension.
    // This will let us have a hook on shutdown to dump the profile
    // to analyse shutdown performance.
    profiler.StopProfiler();
  }
}

exports.test = {
  start: function Test_start() {
    profiler.StopProfiler();
    gGCStats.clear();
    appWrapper.sps_update_status();
    sps_startup(true, {defaultTestSettings:true});
  },
  stop: function Test_stop(stop_callback) {
    dump("ask to stop\n");
    appWrapper.open_cleopatra();
    //stop_profiler(null, null, function stopped_test() {
    //  dump("stop\n");
    //  dump("Test completed: " + JSON.stringify(savedProfileLastStop) + "\n");
    //});
  },
}

