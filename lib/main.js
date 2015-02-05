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
Cu.import("resource://gre/modules/ChromeManifestParser.jsm");
Cu.import("resource://services-common/utils.js");
Cu.import("resource://gre/modules/osfile.jsm")

var FORCE_DEBUG = false;
//var FORCE_DEBUG = true;

// Change in SymbolicateModule.jsm
const DEFAULT_SYMBOLICATION_URL = "http://symbolapi.mozilla.org/";
//var DEFAULT_UI_URL = "http://ehsan.github.com/cleopatra/";
var OLD_UI_URL = "http://varium.fantasytalesonline.com/cleopatra/";
var OLD_UI_URL2 = "file:///Users/bgirard/ben/sps/cleopatra/index.html";
var DEFAULT_UI_URL = "http://people.mozilla.com/~bgirard/cleopatra/";
//var DEFAULT_UI_URL = "file:///home/v/work/cleopatra/index.html";
//var DEFAULT_UI_URL = "file:///home/vladimir/proj/profiler/cleopatra/index.html";
//var DEFAULT_UI_URL = "file:///Users/bgirard/ben/sps/cleopatra/index.html";
//var DEFAULT_UI_URL = "http://localhost/~markus/cleopatra/";
var DEFAULT_ANDROID_LIBS_PATH = "/tmp";
var DEFAULT_ANDROID_FENNEC_LIBS_PATH = "/tmp";

//let perf_tests = require("perf_tests/harness");
let remote = require("remote");
let remoteProfilerFile = require("remoteProfiler");
let screencast = require("screencast");
let remoteHost = require("remoteHost");
var remoteHostInstance = null;
let prefs = require("prefs");
let data = require("sdk/self").data;
let timers = require("sdk/timers");
let file = require("sdk/io/file");
let tabs = null;
let panelModule;
let windowUtils;

let gProfileStartEpoch = null;

// For Thunderbird the tabs module is not supported, and will throw if we try
// to import it 
if (!require("sdk/system/xul-app").is("Thunderbird")) {
  try {
    tabs = require("sdk/tabs");
    panelModule = require("sdk/panel");
  } catch (e) {}
  windowUtils = require("sdk/deprecated/window-utils");
}

let Request = require("sdk/request").Request;

let symbolicateModule = Cu.import(data.url("SymbolicateModule.jsm"));
let cmdRunnerModule = Cu.import(data.url("CmdRunner.jsm"));

let appWrapper = null;
var profiler = null;
var profilerFeatures = [];
var profilerIsActive = false;
var featuresToUse = [];
var startedWithFeatures = [];
var panel = null;
var c = 0;
var settingsTab = null;
var settingsTabPort = null;
var savedProfileLastStop = null;
var threadFilter = '';

var gHasScreencast = false;
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

const toolbarButton = require("ui/toolbarbutton");

// add hotkey
const { XulKey } = require("xul/key");

XulKey({
  id: "RR:ToggleProfiler",
  modifiers: "control shift",
  key: "!",
  onCommand: function() {
    if (profilerIsActive) {
      stop_profiler();
    } else {
      sps_startup(true);
    }
  }
});

XulKey({
  id: "RR:DumpProfile",
  modifiers: "control shift",
  key: "@",
  onCommand: function() {
    //perf_tests.run_all_tests();
    appWrapper.open_cleopatra();
  }
});

function EnableShutdownWatcher(profiler) {
  var want_feature_watchdog = prefs.get_pref_bool("profiler.", "performanceReporter", false);

  if (!want_feature_watchdog)
    return;

  var updateChannel = prefs.get_pref_string("app.update.", "channel", "default").toLowerCase();
  if (updateChannel != "nightly" && updateChannel != "aurora" && updateChannel != "beta" && updateChannel != "release") {
    dump("Can't use watchdog on local build or custom branches\n");
    // Don't watch non build if the're not from the above branches
    return;
  }

  var shutdownObserver = {
    observe: function (subject, topic, data) {
      let env = Cc["@mozilla.org/process/environment;1"].getService(Ci.nsIEnvironment);
      var profilingShutdown = !!env.get("MOZ_PROFILER_SHUTDOWN");
      // User asked for a manual shutdown profiling. Don't interfere
      if (profilingShutdown) {
        dump("Manual profiling shutdown - no watchdog\n");
        return;
      }

      var shutdownURL = appWrapper.setShutdownEnv();
      if (shutdownURL == null) {
        return;
      }

      // Set this so we can restore the profile on the next restart
      prefs.set_pref_string("profiler.", "saved_shutdown_profile", shutdownURL);
      prefs.set_pref_string("profiler.", "saved_shutdown_profile_ua", get_user_agent());

      stop_profiler(false, function stop_cb() {
        sps_startup(true, {
          interval: 10,
          entries: 80000,
        });
      });
    }
  };

  profiler.registerEventNotifications(["quit-application-granted"], shutdownObserver);
}

function Timeline(profiler, options) {
  this._samples = [];
  this._interval = 200;
  this._name = options.name;

  var self = this;
  timers.setInterval(function() {
    var data = options.getData();
    self._samples.push({
      time: new Date().getTime() - gProfileStartEpoch,
      data: data,
    });
    if (self._samples.length > 200) {
      self._samples.shift();
    }
  }, this._interval);
}
Timeline.prototype = {
  getData: function Timeline_getData() {
    return {
      name: this._name,
      interval: this._interval,
      samples: this._samples,
    };
  },
};

function GCStats(profiler) {
  this._gcEvents = [];
  this._ccEvents = [];

  var want_feature_gc = prefs.get_pref_bool("profiler.", "gc", true);

  if (!want_feature_gc)
    return;

  // Fow now disable the feature because of the timestamp changes made
  if (true)
    return;

  prefs.set_pref_bool("javascript.options.mem.", "notify", true);

  var self = this;
  var GCStatObserver = {
    observe: function (subject, topic, data) {
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
  };
  var CCStatObserver = {
    observe: function (subject, topic, data) {
      var parsedEvent = JSON.parse(data);
      // Convert to milliseconds and normalize to start of profiling
      parsedEvent.timestamp = parsedEvent.timestamp / 1000 - gProfileStartEpoch;
      parsedEvent.start_timestamp = parsedEvent.timestamp - parsedEvent.duration;
      parsedEvent.end_timestamp = parsedEvent.timestamp;
      self.addCC(parsedEvent);
    }
  };

  profiler.registerEventNotifications(["garbage-collection-statistics"], GCStatObserver);
  profiler.registerEventNotifications(["cycle-collection-statistics"], CCStatObserver);
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

function ReadAsString(file) {
    file = "file://" + file;
    var ioService=Cc["@mozilla.org/network/io-service;1"]
        .getService(Ci.nsIIOService);
    var scriptableStream=Cc["@mozilla.org/scriptableinputstream;1"]
        .getService(Ci.nsIScriptableInputStream);

    var channel=ioService.newChannel(file,null,null);
    var input=channel.open();
    scriptableStream.init(input);
    var str=scriptableStream.read(input.available());
    scriptableStream.close();
    input.close();
    return str;
}

// Usage:
// var lazyObj = new LazyMethodCallBuffer(["method1", "method2"]);
// lazyObj.method1("hello");
// lazyObj.method2({ world: 4 }, true);
// lazyObj.resolveObject(theRealObject);
// lazyObj.method1("call");
// 
// This will call all methods on theRealObject in the correct order with the
// right arguments.
function LazyMethodCallBuffer(methodNames) {
  var bufferedCalls = [];
  var wrappedObject = null;
  this.resolveObject = function (obj) {
    // Flush bufferedCalls into obj.
    for (var i = 0; i < bufferedCalls.length; i++) {
      var bufferedCall = bufferedCalls[i];
      obj[bufferedCall.methodName].apply(obj, bufferedCall.args);
    }
    bufferedCalls = [];
    wrappedObject = obj;
  }

  // For each method to buffer, create a mock method that either forwards to
  // the wrapped object directly (once it's known) or buffers the call if not.
  for (var i = 0; i < methodNames.length; i++) {
    var methodName = methodNames[i];
    this[methodName] = function mockMethod() {
      var args = Array.prototype.slice.call(arguments);
      if (wrappedObject) {
        // Pipe through directly.
        wrappedObject[methodName].apply(wrappedObject, args);
      } else {
        // Buffer the call.
        bufferedCalls.push({ methodName: methodName, args: args });
      }
    }
  }
}

function Profiler(options, cb) {
  this._profiler = Cc["@mozilla.org/tools/profiler;1"].getService(Ci.nsIProfiler);
  this._eventObservers = {};
  this.gcStats = new GCStats(this);

  let mgr = Cc["@mozilla.org/memory-reporter-manager;1"].getService(Ci.nsIMemoryReporterManager);
  this._timelines = [];
  if (prefs.get_pref_bool("profiler.", "memoryTimeline", false)) {
    this._timelines = [
      new Timeline(this, {
        name: "Resident",
        getData: function getData() {
          let e = mgr.enumerateReporters();
          while (e.hasMoreElements()) {
            let mr = e.getNext().QueryInterface(Ci.nsIMemoryReporter);
            let isReporter = mr.path == "resident";
            if (!isReporter) {
              continue;
            }

            try {
              return mr.amount;
            } catch (e) {}
          }

          return 0;
        }
      }),
      new Timeline(this, {
        name: "js-gc-heap",
        getData: function getData() {
          let e = mgr.enumerateReporters();
          while (e.hasMoreElements()) {
            let mr = e.getNext().QueryInterface(Ci.nsIMemoryReporter);
            let isReporter = mr.path == "js-gc-heap";
            if (!isReporter) {
              continue;
            }

            dump("Found: " + mr.amount + "\n");

            try {
              return mr.amount;
            } catch (e) {}
          }

          return 0;
        }
      })
    ];
  }
  this.shutdownWatchdog = new EnableShutdownWatcher(this);
  cb.call(this);
}

Profiler.prototype = {
  _profiler_start: function (entries, interval, features, threads) {
    // helper function to accommodate different versions of nsIProfiler::StartProfiler
    if (threads.length) {
      try {
        this._profiler.StartProfiler(entries, interval, features, features.length, threads, threads.length);
        return;
      } catch (e) {
      }
    }
    this._profiler.StartProfiler(entries, interval, features, features.length);
  },
  start: function profiler_start(entries, interval, features, threads, cb) {
    //console.log(new Error("myError").stack);
    this._profiler_start(entries, interval, features, threads);
    if (cb) cb.call(this);
  },
  stop: function profiler_stop(cb) {
    this._profiler.StopProfiler();
    this.gcStats.clear();
    if (cb) cb.call(this);
  },
  getTimelines: function profiler_getTimeline() {
    var timelines = [];

    for (var i in this._timelines) {
      var timeline = this._timelines[i];
      timelines.push(timeline.getData());
    }

    return timelines;
  },
  getPlatform: function profiler_getPlatform() {
    // Default to the host platform
    return null;
  },
  getHardwareID: function profiler_getHardwareID() {
    return null;
  },
  getTargetDescription: function remote_getTargetDescription() {
    return "Local";
  },
  getProfile: function profiler_getProfile(cb) {
    let profile = this._profiler.getProfileData();
    if (cb) cb.call(this, profile);
  },
  isActive: function profiler_isActive(cb) {
    let isActive = this._profiler.IsActive();
    if (cb) cb.call(this, isActive);
  },
  getResponsivenessTimes: function profiler_getResponsivenessTimes(cb) {
    let times = this._profiler.GetResponsivenessTimes([]);
    if (cb) cb.call(this, times);
  },
  getFeatures: function profiler_getFeatures(cb) {
    let features = this._profiler.GetFeatures([]);
    if (cb) cb.call(this, features);
  },
  getSharedLibraryInformation: function profiler_getSharedLibraryInformation(cb) {
    let libs = this._profiler.getSharedLibraryInformation();
    if (cb) cb.call(this, libs);
  },
  registerEventNotifications: function profiler_registerEventNotifications(events, observer) {
    if (!'observe' in observer)
      return;
    for (let event of events) {
      if (event in this._eventObservers) {
        if (this._eventObservers[event].indexOf(observer) != -1)
          continue;
      } else {
        this._eventObservers[event] = [];
      }
      this._eventObservers[event].push(observer);
      Services.obs.addObserver(observer, event, false);
    }
  },
  unregisterEventNotifications: function profiler_unregisterEventNotifications(events, observer) {
    for (let event of events) {
      if (!event in this._eventObservers)
        continue;
      var idx = this._eventObservers[event].indexOf(observer);
      if (idx == -1)
        continue;
      Services.obs.removeObserver(observer, event);
      this._eventObservers[event].splice(idx, 1);
      if (this._eventObservers[event].length == 0)
          delete this._eventObservers[event];
    }
  },
  shutdown: function profiler_shutdown() {
    this.gcStats.shutdown();
    for (let event in this._eventObservers) {
      for (let observer of this._eventObservers[event]) {
        this.unregisterEventNotifications([event], observer);
      }
    }
  },
};

exports.GCStats = GCStats;
exports.Profiler = Profiler;

function get_feature_pref() {
    var featurePrefs = {};
    for (var i = 0; i < profilerFeatures.length; i++) {
        var feature = profilerFeatures[i];
        featurePrefs[feature] = prefs.get_pref_bool("profiler.", feature);
    }
    if (has_feature('threads')) {
        featurePrefs['threadfilter'] = prefs.get_pref_string('profiler.', 'threadfilter', '');
    }
    return featurePrefs;
}

function has_stackwalk() {
    return true;
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

// Addons can register their files in such a way that chrome URIs in the form of
// chrome://somehostname/registered/path/to/file points to the registered file.
// This is done using the "content" directive in their chrome manifest, see
// https://developer.mozilla.org/en-US/docs/Chrome_Registration
// This function returns, for any given addon, an array of registered chrome URI
// "hosts", like "somehostname" in the example above.
function getAddonChromeURIHosts(addon) {
  if (!addon.getResourceURI)
    return [];

  var manifestURI = addon.getResourceURI("chrome.manifest");
  var manifest = ChromeManifestParser.parseSync(manifestURI);
  return manifest.filter(function(x) x.type == "content").map(function (x) x.args[0]);
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
        creator: addon.creator,
        chromeURIHosts: getAddonChromeURIHosts(addon)
      });
    });
  }, function (addonInfo) {
    addonInfoCallback(addonInfo);
  });
}

function profiler_reset_debug_features() {
  prefs.set_pref_bool("profiler.", "layersdump", false);
  prefs.set_pref_bool("profiler.", "displaylistdump", false);
}


function stop_profiler(forceCache, save_callback) {
  DEBUGLOG("Stop profiler");
  profiler.stop(function() {
    appWrapper.observe(null, "profile-stopped", null);
    if (save_callback) save_callback();
  });
}

function get_interval_float() {
  var interval = parseFloat(prefs.get_pref_string("profiler.", "intervalMs"));
  if (isNaN(interval)) {
    return 1; // default interval
  }
  return interval;
}

function sps_startup(force, manifest) {
    manifest = manifest || {};

    prefs.default_init_pref("profiler.", "stackwalk", true);
    prefs.default_init_pref("profiler.", "unwinder", false);
    prefs.default_init_pref("profiler.", "profileJava", false);
    prefs.default_init_pref("profiler.", "memoryTimeline", false);
    prefs.default_init_pref("profiler.", "threads", true);
    prefs.default_init_pref("profiler.", "gpu", false);
    prefs.default_init_pref("profiler.", "power", false);
    prefs.default_init_pref("profiler.", "jank", false);
    prefs.default_init_pref("profiler.", "adb", false);
    prefs.default_init_pref("profiler.", "js", true);
    prefs.default_init_pref("profiler.", "gc", true);
    prefs.default_init_pref("profiler.", "layersdump", false);
    prefs.default_init_pref("profiler.", "displaylistdump", false);
    prefs.default_init_pref("profiler.", "debug", false);
    prefs.default_init_pref("profiler.", "mainthreadio", false);
    prefs.default_init_pref_string("profiler.", "symbolicationUrl", DEFAULT_SYMBOLICATION_URL);
    prefs.default_init_pref_string("profiler.", "url", DEFAULT_UI_URL);
    prefs.default_init_pref_string("profiler.", "androidLibsHostPath", DEFAULT_ANDROID_LIBS_PATH);
    prefs.default_init_pref_string("profiler.", "fennecLibsHostPath", DEFAULT_ANDROID_FENNEC_LIBS_PATH);
    
    // Watch dog info
    prefs.default_init_pref("profiler.", "performanceReporter", false); // This pref has privacy implication. Always off by default!
    prefs.default_init_pref_string("profiler.", "username", "Anonymous");
    prefs.default_init_pref_string("profiler.", "description", "");

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
    if (settingsVersion < 4) {
      prefs.set_pref_bool("profiler.", "adb", false);
      prefs.set_pref_int("profiler.", "version", 4);
    }
    if (settingsVersion < 5) {
      prefs.set_pref_bool("profiler.", "enabled", true);
      prefs.set_pref_int("profiler.", "version", 5);
    }
    if (settingsVersion < 6) {
      prefs.set_pref_bool("profiler.", "gpu", false);
      prefs.set_pref_int("profiler.", "version", 6);
    }
    if (settingsVersion < 7) {
      prefs.clear_user_pref("profiler.", "interval");
      prefs.set_pref_string("profiler.", "intervalMs", "1");
      prefs.set_pref_int("profiler.", "version", 7);
    }

    if (!force) {
      profiler_reset_debug_features();
    }

    var features = profilerFeatures;
    var entries = prefs.get_pref_int("profiler.", "entries");
    var interval = get_interval_float();
    var want_feature_js = prefs.get_pref_bool("profiler.", "js", true);
    var want_feature_gc = prefs.get_pref_bool("profiler.", "gc", true);
    var want_feature_stackwalk = prefs.get_pref_bool("profiler.", "stackwalk", true);
    var want_feature_unwinder = prefs.get_pref_bool("profiler.", "unwinder", false);
    var want_feature_java = prefs.get_pref_bool("profiler.", "profileJava", false);
    var want_feature_threads = prefs.get_pref_bool("profiler.", "threads", false);
    var want_feature_gpu = prefs.get_pref_bool("profiler.", "gpu", false);
    var want_feature_power = prefs.get_pref_bool("profiler.", "power", false);
    var want_feature_jank = prefs.get_pref_bool("profiler.", "jank", false);
    var want_feature_layersdump = prefs.get_pref_bool("profiler.", "layersdump", false);
    var want_feature_displaylistdump = prefs.get_pref_bool("profiler.", "displaylistdump", false);
    var want_feature_adb = prefs.get_pref_bool("profiler.", "adb", false);
    var want_feature_mainthreadio = prefs.get_pref_bool("profiler.", "mainthreadio", false);
    threadFilter = prefs.get_pref_string('profiler.', 'threadfilter', 'GeckoMain,Compositor');

    if (manifest.defaultTestSettings) {
      entries = 1000000;
      interval = 1;
      want_feature_gpu = true;
      want_feature_js = true;
      want_feature_stackwalk = true;
      want_feature_unwinder = false;
      want_feature_threads = false;
      want_feature_java = false;
      want_feature_layersdump = false;
      want_feature_displaylistdump = false;
      want_feature_adb = true;
      want_feature_mainthreadio = false;
      threadFilter = '';
    }

    // If overrides are set in the manifest override the preferences.
    interval = manifest.interval || interval;
    entries = manifest.entries || entries;
    want_feature_js = manifest.js || want_feature_js;
    want_feature_gc = manifest.gc || want_feature_gc;
    want_feature_gpu = manifest.gpu || want_feature_gpu;
    want_feature_stackwalk = manifest.stackwalk || want_feature_stackwalk;
    want_feature_unwinder = manifest.unwinder || want_feature_unwinder;
    want_feature_threads = manifest.threads || want_feature_threads;
    want_feature_java = manifest.java || want_feature_java;
    want_feature_jank = manifest.jank || want_feature_jank;
    want_feature_layersdump = manifest.layersdump || want_feature_layersdump;
    want_feature_displaylistdump = manifest.displaylistdump || want_feature_displaylistdump;
    want_feature_adb = manifest.adb || want_feature_adb;
    want_feature_mainthreadio = manifest.mainthreadio || want_feature_mainthreadio;
    threadFilter = manifest.threadFilter || threadFilter;

    // Make sure we have enough entries to get results back
    entries = Math.max(1000, entries);
    
    var selectedFeatures = [];
    var hasDebugFeature = false;

    // Unlike the devtools front end we always want as much info as we can
    // so we ask for this always while it may or may not be supported. 
    selectedFeatures.push("leaf");

    if (has_feature("js") && want_feature_js) {
        selectedFeatures.push("js");
    }
    if (want_feature_gc) {
        selectedFeatures.push("gc");
    }
    if (has_feature("stackwalk") && want_feature_stackwalk) {
        selectedFeatures.push("stackwalk");
    }
    if (has_feature("unwinder") && want_feature_unwinder) {
        selectedFeatures.push("unwinder");
    }
    if (has_feature("threads") && want_feature_threads) {
        selectedFeatures.push("threads");
    }
    if (has_feature("power") && want_feature_power) {
        selectedFeatures.push("power");
    }
    if (has_feature("gpu") && want_feature_gpu) {
        selectedFeatures.push("gpu");
    }
    if (has_feature("java") && want_feature_java) {
        selectedFeatures.push("java");
    }
    if (has_feature("layersdump") && want_feature_layersdump) {
        selectedFeatures.push("layersdump");
        hasDebugFeature = true;
    }
    if (has_feature("displaylistdump") && want_feature_displaylistdump) {
        selectedFeatures.push("displaylistdump");
        hasDebugFeature = true;
    }
    if (has_feature("jank") && want_feature_jank) {
        selectedFeatures.push("jank");
    }
    if (has_feature("adb") && want_feature_adb) {
        selectedFeatures.push("adb");
    }
    if (has_feature("mainthreadio") && want_feature_mainthreadio) {
        selectedFeatures.push("mainthreadio");
    }
    savedProfileLastStop = null; 
    DEBUGLOG("Start profiling with options:");
    DEBUGLOG(selectedFeatures);

    if (prefs.get_pref_bool("profiler.", "enabled") || force == true) {
        gProfileStartEpoch = new Date().getTime();
        profiler.start(entries, interval, selectedFeatures, threadFilter.split(','), function() {
          appWrapper.observe(null, "profiler-started", null);
          startedWithFeatures = selectedFeatures;
          appWrapper.registerConsoleProfilerObserver();
          appWrapper.sps_update_status();
        });
        profiler.stopOnSave = hasDebugFeature;
    } else {
       appWrapper.registerConsoleProfilerObserver();
       appWrapper.sps_update_status();
    }
}

function get_user_agent() {
  var hh = Cc["@mozilla.org/network/protocol;1?name=http"].getService(Ci.nsIHttpProtocolHandler);
  return hh["userAgent"];
}

function queryEscape(str) {
  return encodeURIComponent(str);
}

function store_profile_list(listName, hash, duration) {
  var query = "?name=" + queryEscape(listName);
  query = query + "&duration=" + queryEscape(duration);
  query = query + "&hash=" + queryEscape(hash);
  query = query + "&username=" + queryEscape(prefs.get_pref_string("profiler.", "username", "Anonymous"));
  var hh = Cc["@mozilla.org/network/protocol;1?name=http"].getService(Ci.nsIHttpProtocolHandler);
  for each (var prop in [ "userAgent", "appName", "appVersion",
               "vendor", "vendorSub",
               "product", "productSub",
               "platform", "oscpu", "language", "misc" ]) {
    query = query + "&" + prop + "=" + queryEscape(hh[prop]);
  };
  var storeRequest = Request({
    url: "http://list-store.appspot.com/list-store" + query,
    content: {"store": null},
    onComplete: function (response) {
      dump("Response: " + response.text + "\n");
    }
  }).post();

}

function store_profile(callback, args, parsed_profile) {
    get_profile(null, function(profile) {
      if (parsed_profile && !parsed_profile(profile)) {
        // Don't save
        return;
      }
      var storeRequest = Request({
        url: "http://profile-store.appspot.com/store",
        content: {"file": profile},
        onComplete: function (response) {
          //for (var headerName in response.headers) {
          //    console.log(headerName + " : " + response.headers[headerName]);
          //}
          //console.log("Status text: " + response.text);
          
          // We can't get the redirect so for now we cheat
          // we need to modify the store to give the redirect url
          // in the response.
          var hash = response.text;
          var url = get_ui_url() + "?report=" + response.text;
          console.log("Upload profile to: " + url);
          callback(url, hash);
        }
      }).post();
    }, args);
}

function get_profile(progress_callback, finish_callback, args) {
    function send_profile(profile) {
        if (FORCE_DEBUG || prefs.get_pref_bool("profiler.", "debug")) {
          DEBUGLOG("PROFILERDEBUG: " + JSON.stringify(profile));
        }
        if (profile == null) {
            progress_callback({progress: 1, action: "Empty profile"});
            return;
        }
        profiler.getSharedLibraryInformation(function(sharedLibraries) {
            symbolicateModule.symbolicate(profile, profiler.getPlatform(), sharedLibraries,
                                      progress_callback,
                                      finish_callback,
                                      profiler.getHardwareID());
        });
    } 

    if (args && args.customProfile) {
      send_profile(args.customProfile);
      return;
    }
    
    if (progress_callback != null) {
        progress_callback({progress: 0, action: "Retrieving profile"});
    }
    DEBUGLOG("Get profile");
    var profile;
    if (profilerIsActive == false && savedProfileLastStop != null) {
        DEBUGLOG("Using last profile");
        profile = savedProfileLastStop;
        send_profile(profile);
    } else {
        DEBUGLOG("get json profile");
        profiler.getProfile(function(profile) {
            if (profiler.stopOnSave) {
              profiler.stop();
              profiler.stopOnSave = false;
              appWrapper.sps_update_status();
            }

            DEBUGLOG("got json profile");
            function prepare_profile(options) {
                    profile.meta = profile.meta || {};
                    profile.meta.addons = [];
                    if (options && options.videoCapture) {
                      profile.meta.videoCapture = options.videoCapture;
                    }
                    AddonManager.getAllAddons(function getAddons(addons) {
                        DEBUGLOG("got extensions");
                        getAddonInfo(addons, function (addonInfo) {
                            profile.meta.addons = addonInfo;
                            profile.meta.gcStats = profiler.gcStats.getData();
                            profile.meta.timelines = profiler.getTimelines();
                            try {
                                send_profile(profile);
                            } catch (e) {
                                dump("Profiler Exception: " + e);
                                progress_callback({progress: 0, action: "Profiler Exception: " + e}); 
                            }
                        });
                    });
            }
            if (false && screencast && screencast.isRecording()) {
              progress_callback({progress: 0, action: "Saving screencast"}); 
              screencast.stop(function screencast_stopped() {
                progress_callback({progress: 0, action: "Transcoding"}); 
                screencast.transcode(function() {
                  prepare_profile({
                    videoCapture: {
                      src: "http://people.mozilla.com/~bgirard/gp.webm"
                    }
                  });
                }, function progress(r) {
                  progress_callback({progress: 0, action: "Transcoding: " + r}); 
                });  
              });
            } else {
              prepare_profile();
            }
        });
    }
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
    if (!tabs) {
      tabs = require("sdk/tabs");
    }
    if (!tabs) {
      tabs = require("sdk/tabs");
    }
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
              prefs.set_pref_string("profiler.", "intervalMs", obj.interval);
              prefs.set_pref_int("profiler.", "entries", obj.entries);
              if (profilerIsActive) {
                stop_profiler(false, function() {
                  sps_startup(true);
                });
              }
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

  initProfiler: function tb_initProfiler(ProfilerWrapper, options, cb) {
    var that = this;
    try {
      new ProfilerWrapper({}, function() {
        profiler = this;
        this.registerEventNotifications(["profiler-started", "profiler-stopped"], that);

        this.getFeatures(function(features) {
            profilerFeatures = features;
            // Add-on side feature
            profilerFeatures.push("adb");
            profilerFeatures.push("gc");
            profilerFeatures.push("performanceReporter");
            this.isActive(function(isActive) {
                profilerIsActive = isActive;
                cb.call(that);
                that.sps_update_status();
            });
        });
      });
    } catch(e) {
      console.error("Profiler module not found: " + e.message + ", " + e.stack);
    }
  },
  init: function tb_init() {
    console.log("tb_init entered.");
    this.initProfiler(Profiler, {}, function() {
      let doc = Services.wm.getMostRecentWindow('mail:3pane').document;
      let statusBar = doc.getElementById('status-bar');

      this._dumpButton = doc.createElementNS(
        'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul',
        'statusbarpanel');

      this._toggle = this._dumpButton.cloneNode();
      this._toggle.setAttribute('id', 'toggleProfiler');
      this._toggle.addEventListener('click', function(aEvent) {
        if (profilerIsActive)
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
        if (profilerIsActive)
          this.open_cleopatra();
      }.bind(this));

      statusBar.appendChild(this._dumpButton);
    });
  },

  shutdown: function tb_shutdown() {
    if (profiler)
      profiler.shutdown();

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
    let toggleLabel = profilerIsActive ? "Enabled" : "Disabled";
    let toggleStyle = profilerIsActive ? "#00611C" : "#551011";

    this._toggle.setAttribute('label', toggleLabel);
    this._toggle.style.color = toggleStyle;
  },

  open_cleopatra: function tb_open_cleopatra(aProfileType, args, callback) {
    if (aProfileType == null)
        aProfileType = 'desktop';

    // We append a timestamp because we want a new tab each time we dump the
    // profile. If we don't do this, Thunderbird tries to refocus the old tab.
    let front_end_url = get_ui_url() + "?" + Date.now();
    let self = this;

    // Get the most recent 3pane
    try {
      this._is_spinning(true);

      var lazyWindow = LazyMethodCallBuffer(["postMessage"]);

      lazyWindow.postMessage(JSON.stringify({
        task: "importFromAddonStart",
      }), "*");

      console.log('Fetching profile.');

      // Start fetching the profile before we open the tab so that the tab
      // opening delay doesn't end up in the profile.
      get_profile(
        function(aMsg) {
          lazyWindow.postMessage(JSON.stringify({
            task: "importFromAddonProgress",
            progress: aMsg.progress,
            action: aMsg.action
          }), "*");
        },
        function(aProfile) {
          console.log('Completed getting profile');
          self._is_spinning(false);
          lazyWindow.postMessage(JSON.stringify({
            task: "importFromAddonFinish",
            rawProfile: aProfile
          }), "*");
          callback(aProfile);
        }
      );

      let tabmail = this._get_most_recent_tabmail();

      console.log("About to open up the contentTab");
      let tab = tabmail.openTab('contentTab', {
        contentPage: front_end_url,
      });

      if (!tab)
        throw new Error('Could not open the Cleopatra tab.');

      // Once the tab is open and loaded, flush the buffered messages to the
      // window.
      tab.browser.addEventListener('DOMContentLoaded', function(aEvent) {

        tab.browser.removeEventListener('DOMContentLoaded',
                                        arguments.callee,
                                        true);

        lazyWindow.resolveObject(tab.browser.contentWindow);
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
    if (aEnable == profilerIsActive)
      return;

    if (!aEnable) {
      stop_profiler();
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

  observe: function tb_observe(subject, topic, data) {
    if (topic == "profiler-started")
      profilerIsActive = true;
    else if (topic == "profiler-stopped")
      profilerIsActive = false;
    appWrapper.sps_update_status();
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
  tbb: null,
  tbbOptions: null,
  initProfiler: function ff_initProfiler(ProfilerWrapper, options, cb) {
    var that = this;
    try {
      if (ProfilerWrapper == null) {
        dump("is null\n");
      }
      new ProfilerWrapper(options, function() {
        profiler = this;
        this.registerEventNotifications(["profiler-started", "profiler-stopped"], that);

        this.getFeatures(function(features) {
          profilerFeatures = features;
          // Add-on side feature
          profilerFeatures.push("adb");
          profilerFeatures.push("gc");
          profilerFeatures.push("performanceReporter");
          profiler.isActive(function(isActive) {

            function handle_shutdown_profile() {
              var profilingShutdown = !!env.get("MOZ_PROFILER_SHUTDOWN");
              profilingShutdown |= !!prefs.get_pref_string("profiler.", "saved_shutdown_profile");
              var isShutdownWatchdog = !!prefs.get_pref_string("profiler.", "saved_shutdown_profile");
              if (profilingShutdown) {
                var shutdownLog = !!env.get("MOZ_PROFILER_SHUTDOWN") ? env.get("MOZ_PROFILER_SHUTDOWN")
                                                                     : prefs.get_pref_string("profiler.", "saved_shutdown_profile");

                let shutdownFile = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
                env.set("MOZ_PROFILER_SHUTDOWN", "");
                shutdownFile.initWithPath(shutdownLog);

                if (shutdownFile.exists()) {
                  if (isShutdownWatchdog) {
                    dump("Loading watchdog profile\n");
                    var profile_ua = prefs.get_pref_string("profiler.", "saved_shutdown_profile_ua");
                    if (profile_ua == get_user_agent()) {
                      var storeRequest = Request({
                        url: "http://people.mozilla.org/~bgirard/profiler/shutdown_watchdog",
                        onComplete: function (response) {
                          if (response.text.indexOf("send") == 0) {
                            var duration = null;
                            var profile = ReadAsString(shutdownLog);
                            store_profile(function callback(url, hash) {
                              store_profile_list("profiler.shutdown", hash, duration);
                              shutdownFile.remove(false);
                            }, {customProfile:profile},
                            function should_store_profile(profile) {
                              parsedProfile = JSON.parse(profile).profileJSON;
                              var interval = parsedProfile.meta.interval;
                              var len = parsedProfile.threads[0].samples.length;
                              duration = interval * len;
                              dump("Should store (int:" + interval + ",samples:" + len + ",dur:" + duration + "?\n");
                              if (duration > 1000) {
                                dump("Should store: Y\n");
                                return true;
                              }
                              dump("Should store: N\n");
                              return false; 
                            });
                          } else {
                            dump("Don't send profile: " + response.text + "\n");
                            shutdownFile.remove(false);
                          }
                        }
                      }).get();
                    } else {
                      dump("Version changed so we can't use this profile since local symbols may have changed\n");
                    }
                  } else {
                    var profile = ReadAsString(shutdownLog);
                    appWrapper.open_cleopatra("desktop", {customProfile:profile});
                  }
                } else {
                  dump("Failed to process MOZ_PROFILER_SHUTDOWN, shutdown file not found: '" + profilingShutdown + "'\n");
                }
              }
              prefs.set_pref_string("profiler.", "saved_shutdown_profile", "");
            }

            profilerIsActive = isActive;

            cb.call(that);

            // Check if we're profiling the startup in which case we've already been
            // profiling the startup. We should dump this data and continue preparing
            // the extension
            let env = Cc["@mozilla.org/process/environment;1"].getService(Ci.nsIEnvironment);
            var profilingStartup = !!env.get("MOZ_PROFILER_STARTUP");

            // Save the startup profile before handling the previous shutdown
            // since we're still profiling here.
            if (profilingStartup) {
              env.set("MOZ_PROFILER_STARTUP", "");
              analyze(function () {
                sps_startup();
                handle_shutdown_profile();
              });
            } else {
              sps_startup();
              handle_shutdown_profile();
            }


          });
        });
      });
    } catch(e) {
      console.error("Profiler module not found: " + e.message + ", " + e.stack);
    }
  },
  init: function ff_init() {

      let self = this;
      //screencast.hasPreReq(function cb_ok(results) {
      //  gHasScreencast = true;
      //  self.sps_update_status();
      //});

      if (!tabs) {
        tabs = require("sdk/tabs");
      }
      if (!panelModule) {
        panelModule = require("sdk/panel");
      }
      panel = panelModule.Panel({
          width: 350,
          height: 330,
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
      tbbOptions = {
        panel: panel,
        id: "gecko-profiler-button",
        image: data.url("toolbar_on.png"),
        label: "Gecko Profiler",
        toolbarID: "nav-bar",
        tooltiptext: "Gecko Profiler Add-on",
        forceMove: true
      };
      tbb = toolbarButton.ToolbarButton(tbbOptions);
      tbb.moveTo({toolbarID: "nav-bar", forceMove: true});

      panel.port.on("start_profiler", function(text) {
        sps_startup(true);
      });
      panel.port.on("stop_profiler", function(text) {
        stop_profiler();
      });
      // Used by the checkbox to toggle a feature
      panel.port.on("set_feature", function(obj) {
          set_feature(obj.feature, obj.value);
      });
      panel.port.on('set_threadfilter', function(obj) {
          prefs.set_pref_string('profiler.', 'threadfilter', obj);
      });
      panel.port.on("getprofile", function(text) {
          analyze();
      });
      panel.port.on("restart", function(text) {
          self.profileRestart();
      });
      panel.port.on("screencast", function(text) {
          screencast.start();
      });

      panel.port.on("importpackage", function(text) {
          // Example from: http://gitorious.org/addon-sdk/bugzilla-triage-scripts/blobs/master/lib/prompts.js
          var window = windowUtils.activeWindow;
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
      panel.port.on("browselibfolder", function(defaultFolder) {
          var window = windowUtils.activeWindow;
          var fp = Cc["@mozilla.org/filepicker;1"]
               .createInstance(Ci.nsIFilePicker);
          fp.init(window, "Folder to cache mobile system libraries", Ci.nsIFilePicker.modeGetFolder);
          fp.appendFilters(Ci.nsIFilePicker.filterAll);
          fp.filterIndex = 0;

          try {
              var initialDir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsILocalFile);
              initialDir.initWithPath(defaultFolder);
              fp.displayDirectory = initialDir;
          } catch (e) {
          }

          var res = fp.show();
          if (res === Ci.nsIFilePicker.returnOK) {
              prefs.set_pref_string("profiler.", "androidLibsHostPath", fp.file.path);
              appWrapper.sps_update_status();
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
      panel.port.on("adbconnect", function(options) {
          var port = options.port;
          var remotePort = options.remotePort;
          prefs.set_pref_string("profiler.", "androidLibsHostPath", options.systemLibCache);
          prefs.set_pref_string("profiler.", "fennecLibsHostPath", options.fennecLibCache);
          remoteHostInstance.setAdbLibCache(options.systemLibCache, options.fennecLibCache);
          remoteHostInstance.prepareLibs(options.pkg,
            function cb(pkgName) {
              remoteHostInstance.forwardPort(port, remotePort, pkgName,
                function cb() {
                    var options = {
                      hostname: "localhost",
                      port: port,
                      targetDescription: "Mobile over ADB",
                      platform: "Android",
                      hardwareID: remoteHostInstance.getHardwareID()
                    };
                    panel.port.emit("show_adb_status",
                        "Set devtools.debugger.remote-enabled pref and " +
                        "manually accept incoming connection. " +
                        "To avoid conflict, only one running app can have this pref set.");
                    self.initProfiler(remoteProfilerFile.RemoteProfiler, options, function() {
                        panel.port.emit("show_panel", "Controls");
                    });
                },
                function error_cb(error) {
                    panel.port.emit("show_log", error.description);  
                }
              );
            },
            function error_cb(error) {
              if (error.pkgs) {
                panel.port.emit("show_packages", error.pkgs);
              }
              panel.port.emit("show_log", error.description);
            },
            function progress_cb(info) {
              panel.port.emit("show_adb_status", info.description);  
            }
          );
      });
      panel.port.on("tcpconnect", function(options) {
          self.initProfiler(remoteProfilerFile.RemoteProfiler, options, function() {
              panel.port.emit("show_panel", "Controls");
          });
      });
      panel.port.on("changetarget", function(target) {
          if (target === "tcp") {
              panel.port.emit("show_panel", "TcpConnect");
          } else if (target === "adb") {
            remoteHost.CreateRemoteHost(
              {},
              function cb(remoteHostCreated) {
                remoteHostInstance = remoteHostCreated; 
                panel.port.emit("show_panel", "AdbConfig"); 
              },
              function error_cb(error) {
                panel.port.emit("show_log", error.description); 
                if (error.url)
                  tabs.open({url: error.url});
              });
          } else if (target === "local") {
              self._initLocalProfiler(function () {
                  panel.port.emit("show_panel", "Controls");
              });
          }
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
              profiler.getResponsivenessTimes(function(times) {
                  panel.port.emit("responsive", times);
              });
          }
      });
      this._initLocalProfiler();
  },

  _initLocalProfiler: function ff__initLocalProfiler(cb) {
    this.initProfiler(Profiler, {}, function() {

      this._runningProfileSessions = {};

      if (cb) cb.call(this);
    });
  },

  registerConsoleProfilerObserver: function ff_ob() {
    var consoleProfilerObserver = {
      observe: function(subject, topic, data) {
        data = subject.wrappedJSObject;

        DEBUGLOG("Got event: " + data.action);

        var labelName = data.arguments[0];
        if (typeof profile !== "string") {
          labelName = "default";
        }

        if (data.action == "profile" && this._runningProfileSessions[labelName] == null) {
          if (Object.keys(this._runningProfileSessions).length === 0) {
            profiler.stop(function () {
              profilerIsActive = false;
              this._runningProfileSessions[labelName] = "Running";
              sps_startup(true);
            }.bind(this));
          } else {
            this._runningProfileSessions[labelName] = "Running";
            if (!profilerIsActive) {
              sps_startup(true);
            }
          }
        } else if (data.action == "profileEnd" && this._runningProfileSessions[labelName] != null) {
          delete this._runningProfileSessions[labelName];
          if (Object.keys(this._runningProfileSessions).length === 0) {
            // Stop the profiler right now record the least noise possible.
            stop_profiler(true, function() {
              this.open_cleopatra("desktop");
            }.bind(this));
          }
        }
      }
    };
    profiler.registerEventNotifications(["console-api-profiler"], consoleProfilerObserver);
  },

  shutdown: function ff_shutdown() {
    if (profiler)
      profiler.shutdown();
  },

  setShutdownEnv: function ff_setShutdownEnv() {
    let env = Cc["@mozilla.org/process/environment;1"].getService(Ci.nsIEnvironment);
    env.set("MOZ_PROFILER_STARTUP", "true");
    var shutdownFile = Cc["@mozilla.org/file/directory_service;1"].getService(Ci.nsIProperties)
                         .get("TmpD", Ci.nsIFile);
    shutdownFile.append("sps_shutdown_" + (new Date().getTime()) + ".dat");
    if (!shutdownFile.exists()) {
      // TODO check if the string is ascii
      var shutdownFilePath = shutdownFile.path;
      // Only attempt shutdown profiling is the path is restricted
      // to ASCII 32..127 because of environment variable restrictions.
      function check_range(str) {
        for (var i = 0; i < shutdownFilePath.length; i++) {
          if (shutdownFilePath.charCodeAt(i) > 127) {
            return false;
          }
        }
        return true;
      }

      if (check_range(shutdownFilePath)) {
        env.set("MOZ_PROFILER_SHUTDOWN", shutdownFilePath);
        return shutdownFilePath;
      } else {
        dump("Can't save shutdown log because shutdown path contains characters outside the restricted 32..127 range.\n");
        return null
      }
    } else {
      dump("Can't save shutdown log because shutdown file exists.\n");
      return null;
    }

  },

  profileRestart: function ff_profileRestart() {
    if (this.setShutdownEnv() == null)
      return;

    let appStartup = Cc["@mozilla.org/toolkit/app-startup;1"].getService(Ci.nsIAppStartup);
    appStartup.quit(appStartup.eForceQuit | appStartup.eRestart);
  },

  get_profiler_status: function ff_profiler_status() {
      var isActive = profilerIsActive;
      var profilerFeaturesPrefs = get_feature_pref();
      var samplingInterval = get_interval_float();
      var sampleBufferSize = prefs.get_pref_int("profiler.", "entries");
      var systemLibCache = prefs.get_pref_string("profiler.", "androidLibsHostPath");
      var fennecLibCache = prefs.get_pref_string("profiler.", "fennecLibsHostPath");
      var iconType = "off";
      var addonLabel = "Stopped";
      if (isActive) {
        iconType = "on";
      }
      tbbOptions.panel = panel;
      tbb.setIcon({url:data.url("toolbar_" + iconType + ".png")});
      var profilerStatus = {
          profilerFeatures: profilerFeatures, 
          profilerFeaturesPrefs: profilerFeaturesPrefs,
          startedWithFeatures: startedWithFeatures, 
          threadFilter: threadFilter,
          isActive: isActive,
          hasScreencast: gHasScreencast,
          samplingInterval: samplingInterval,
          sampleBufferSize: sampleBufferSize,
          systemLibCache: systemLibCache,
          fennecLibCache: fennecLibCache,
          profilerTargetDescription: profiler.getTargetDescription()
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
      if (profilerIsActive == false)
        return;
      if (profileType == null) {
          profileType = "desktop";
      }

      var onlyOnce = true;
      var front_end_url = get_ui_url();
      if (!tabs) {
        tabs = require("sdk/tabs");
      }
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

              // Start fetching the profile before we open the tab so that the tab
              // opening delay doesn't end up in the profile.
              var lazyPort = new LazyMethodCallBuffer(["emit"]);
              lazyPort.emit("importFromAddonStart");
              switch (profileType) {
                case "desktop":
                  get_profile(function(msg) { // progress
                      lazyPort.emit("importFromAddonProgress", msg);
                  }, function(profile) { // complete
                      // Let the UI have a look at the profile, this is used to echo the profile
                      // size by the GCLI
                      if (got_profile_callback) {
                          got_profile_callback(profile);
                      }
                      lazyPort.emit("importFromAddonFinish", profile);
                  }, args);
                  break;
                case "adb":
                  adb_pull(function(msg) { // progress
                      lazyPort.emit("importFromAddonProgress", msg);
                  }, function(profile) { // complete
                      lazyPort.emit("importFromAddonFinish", profile);
                  }, !!args.profileOnly);
                  break;
                case "start":
                  // send a start signal
                  adb_start(function(msg){
                      lazyPort.emit("importFromAddonProgress", msg);
                  }, function(profile){});
                  break;
                case "libs":
                  adb_pull_libs(function(msg) { // progress
                    lazyPort.emit("importFromAddonProgress", msg);
                  }, function(profile) { // complete
                  });
                  break;
                case "importpackage":
                  importPackage(args, function(msg) { // progress
                      lazyPort.emit("importFromAddonProgress", msg);
                  }, function(profile) { // complete
                      lazyPort.emit("importFromAddonFinish", profile);
                  });
                  break;
              }

              // Flush the buffered messages to the port.
              lazyPort.resolveObject(attach.port);

          }
      });

  },

  observe: function ff_observe(subject, topic, data) {
    if (topic == "profiler-started")
      profilerIsActive = true;
    else if (topic == "profiler-stopped")
      profilerIsActive = false;
    appWrapper.sps_update_status();
  },
};

// Thunderbird gets its own super-special initialization.

exports.main = function(aOptions, aCallbacks) {
  if (require("sdk/system/xul-app").is("Thunderbird"))
    appWrapper = ThunderbirdAppWrapper;
  else
    appWrapper = FirefoxAppWrapper;

  appWrapper.init();

  // For testing
  exports.appWrapper = appWrapper;
}

exports.onUnload = function(aReason) {
  if (appWrapper)
    appWrapper.shutdown();
  if (aReason != "shutdown") {
    // Don't stop the profiler is we are only shutting down
    // rather then upgrading or turning of the extension.
    // This will let us have a hook on shutdown to dump the profile
    // to analyse shutdown performance.
    profiler.stop(function() {
      profilerIsActive = false;
    });
  }
}

exports.getAppWrapper = function() {
  return appWrapper;
}

exports.getProfiler = function() {
  return profiler;
}

