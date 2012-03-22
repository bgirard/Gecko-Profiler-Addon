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

//var DEFAULT_UI_URL = "http://ehsan.github.com/cleopatra/";
var DEFAULT_UI_URL = "http://varium.fantasytalesonline.com/cleopatra/";
//var DEFAULT_UI_URL = "http://localhost/~markus/cleopatra/";

let data = require("self").data;
let clipboard = require("clipboard");
let timers = require("timers");
var tabs = require("tabs");
var Request = require("request").Request;

var symbolicateModule = Cu.import(data.url("SymbolicateModule.jsm"));

var profiler = null;
var profilerFeatures = [];
var spsWidget = null;
var panel = null;
var c = 0;

// add hotkey
const { XulKey } = require("xulkeys");
XulKey({
  id: "RR:DumpProfile",
  modifiers: "accel shift",
  key: "O",
  onCommand: function() {
    open_cleopatra();
  }
});
XulKey({
  id: "RR:ToggleProfiler",
  modifiers: "accel shift",
  key: "S",
  onCommand: function() {
    if (profiler.IsActive()) {
      profiler.StopProfiler();
    } else {
      sps_startup(true);
    }
    sps_update_status();
  }
});

function sps_update_status() {
    var isActive = get_pref_bool("profiler.", "enabled");
    var isActive = profiler.IsActive();
    var status = "Start";
    var addonLabel = "Stopped";
    if (isActive) {
      status = "Stop";
      addonLabel = "Running";
    }
    spsWidget.content = "Profiler: " + addonLabel;
    panel.port.emit("change_status", status);
}

function has_stackwalk() {
    var hh = Cc["@mozilla.org/network/protocol;1?name=http"].getService(Ci.nsIHttpProtocolHandler);
    var platform = hh["platform"];
    if (platform != "Macintosh") return false;
    return profilerFeatures.indexOf("stackwalk") !== -1;
}

function sps_getfeatures() {
    var out = {value:null};
    profiler.GetFeatures(out);
    return out.value; // XXXmstange does this work? for me this is 2
}

function sps_startup(force) {
    if (get_pref_bool("profiler.", "enabled") || force == true) {
        var features = sps_getfeatures();
        var entries = get_pref_int("profiler.", "entries");
        var interval = get_pref_int("profiler.", "interval");
        var walkStack = get_pref_bool("profiler.", "walkstack");
        
        
        try { // Trunk StartProfiler signature
            profiler.StartProfiler(entries, interval);
        } catch (e) { // Feature based signature that hasn't landed yet
            var selectedFeatures = [];
            if (has_stackwalk()) {
                selectedFeatures.push("stackwalk");
            }
            profiler.StartProfiler(entries, interval, selectedFeatures, selectedFeatures.length);
        }
        if (walkStack && features.indexOf("SPS_WALK_STACK") != -1) {
            profiler.EnableFeature("SPS_WALK_STACK");
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
    timers.setTimeout(function() {
        var dummy = {value:null};
        var profile = profiler.GetProfile(dummy);
        if (profile == null) {
            progress_callback({progress: 1, action: "Empty profile"});
            return;
        }
        function afterSymbolication(symbolicationTable) {
            finish_callback(profile, symbolicationTable);
        }
        var sharedLibraries = profiler.getSharedLibraryInformation();
        symbolicateModule.symbolicate(profile, sharedLibraries,
                                      progress_callback,
                                      afterSymbolication);
    }, 0);
    return;
}

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

function get_ui_url() {
    return get_pref_string("profiler.", "url", DEFAULT_UI_URL);
}

function open_cleopatra() {
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
            attach.port.on("getprofile", function(text) {
                get_profile(function(msg) { // progress
                    attach.port.emit("getprofile_progress", msg);
                }, function(profileString, symbolicationTable) { // complete
                    var bundle = {
                        format: "profileStringWithSymbolicationTable,1",
                        profileString: profileString,
                        symbolicationTable: symbolicationTable
                    };
                    attach.port.emit("getprofile", JSON.stringify(bundle));
                });
            });
        }
    });
}

function init() {
    panel = require("panel").Panel({
        width:215,
        height:160,
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
            return get_pref_bool("profiler.", "enabled");
        }
    });
    panel.port.on("toggle", function(text) {
        if (profiler.IsActive()) {
            profiler.StopProfiler();
        } else {
            sps_startup(true);
        }
        sps_update_status();
    });
    panel.port.on("getprofile", function(text) {
        open_cleopatra();
        panel.hide();
    });
    panel.port.on("filebug", function(text) {
        bugzilla_file_bug();
        panel.hide();
    });
    panel.port.on("responsive", function(text) {
        var data = profiler.GetResponsivenessTimes({});
        panel.port.emit("responsive", data);
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
    } catch(e) { }
    
    spsWidget = require("widget").Widget({
      id: "hello-display",
      label: "Built-in Profiler",
      content: "Profiler",
      width: 200,
      panel: panel
    });
    
    sps_startup(true);
    sps_update_status();
}

function get_pref_int(branch, node) {
    var prefs = Cc["@mozilla.org/preferences-service;1"]
                    .getService(Ci.nsIPrefService).getBranch(branch);
    
    var value = prefs.getIntPref(node);
    return value;
}

function get_pref_bool(branch, node, defaultValue) {
    var prefs = Cc["@mozilla.org/preferences-service;1"]
                    .getService(Ci.nsIPrefService).getBranch(branch);
    try {
        return prefs.getBoolPref(node);
    } catch (e) {
        if (defaultValue == null)
            defaultValue = false;
        return defaultValue;
    }
    return value;
}

function set_pref_bool(branch, node, value) {
    var prefs = Cc["@mozilla.org/preferences-service;1"]
                    .getService(Ci.nsIPrefService).getBranch(branch);
    
    var value = prefs.setBoolPref(node, value);
}

function get_pref_string(branch, node, defaultValue) {
    var prefs = Cc["@mozilla.org/preferences-service;1"]
                    .getService(Ci.nsIPrefService).getBranch(branch);
    try {
        return prefs.getCharPref(node);
    } catch (e) {
        return defaultValue;
    }
    return "??";
}

init();
