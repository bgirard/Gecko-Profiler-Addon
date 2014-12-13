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
 
var gStartedWithFeatures = [];
var gFeatureList = [];
var gUpdateInterval = null;
var gFeaturesPrefs = {};
var gThreadFilter = '';

function has_feature(feature) {
  return gFeatureList.indexOf(feature) !== -1;
}
function has_feature_active(feature) {
  return gStartedWithFeatures.indexOf(feature) !== -1;
}
function get_feature_pref(feature) {
      return gFeaturesPrefs[feature] === true;
}

self.port.on("change_status", function(val) {
    gStartedWithFeatures = val.startedWithFeatures;
    gFeatureList = val.profilerFeatures;
    gFeaturesPrefs = val.profilerFeaturesPrefs;
    gThreadFilter = val.threadFilter || '';

    var chkJank = document.getElementById("chkJank");
    if (chkJank) {
      chkJank.disabled = !has_feature("jank") || val.isActive;
      chkJank.checked = val.isActive ? has_feature_active("jank") : get_feature_pref("jank");
      chkJank.onclick = function() {
        self.port.emit("set_feature", {feature: "jank", value: chkJank.checked});
      }
    }

    var chkStackwalk = document.getElementById("chkStackwalk");
    if (chkStackwalk) {
      chkStackwalk.disabled = !has_feature("stackwalk") || val.isActive;
      chkStackwalk.checked = val.isActive ? has_feature_active("stackwalk") : get_feature_pref("stackwalk");
      chkStackwalk.onclick = function() {
        self.port.emit("set_feature", {feature: "stackwalk", value: chkStackwalk.checked});
      }
    }

    var chkUnwinder = document.getElementById("chkUnwinder");
    if (chkUnwinder) {
      chkUnwinder.disabled = !has_feature("unwinder") || val.isActive;
      chkUnwinder.checked = val.isActive ? has_feature_active("unwinder") : get_feature_pref("unwinder");
      chkUnwinder.onclick = function() {
        self.port.emit("set_feature", {feature: "unwinder", value: chkUnwinder.checked});
      }
    }

    var chkThreads = document.getElementById("chkThreads");
    var txtThreadFilter = document.getElementById('txtThreadFilter');
    if (chkThreads) {
      chkThreads.disabled = !has_feature("threads") || val.isActive;
      chkThreads.checked = val.isActive ? has_feature_active("threads") : get_feature_pref("threads");
      chkThreads.onclick = function() {
        self.port.emit("set_feature", {feature: "threads", value: chkThreads.checked});
        txtThreadFilter.disabled = !chkThreads.checked;
      }
    }

    if (txtThreadFilter) {
      txtThreadFilter.disabled = chkThreads.disabled || !chkThreads.checked;
      txtThreadFilter.value = val.isActive ? gThreadFilter : (gFeaturesPrefs['threadfilter'] || '');
      txtThreadFilter.onchange = function() {
        self.port.emit('set_threadfilter', txtThreadFilter.value);
      };
    }

    var chkPower = document.getElementById("chkPower");
    if (chkPower) {
      chkPower.disabled = !has_feature("power") || val.isActive;
      chkPower.checked = val.isActive ? has_feature_active("power") : get_feature_pref("power");
      chkPower.onclick = function() {
        self.port.emit("set_feature", {feature: "power", value: chkPower.checked});
      }
    }

    var chkGPU = document.getElementById("chkGPU");
    if (chkGPU) {
      chkGPU.disabled = !has_feature("gpu") || val.isActive;
      chkGPU.checked = val.isActive ? has_feature_active("gpu") : get_feature_pref("gpu");
      chkGPU.onclick = function() {
        self.port.emit("set_feature", {feature: "gpu", value: chkGPU.checked});
      }
    }

    var chkJS = document.getElementById("chkJS");
    if (chkJS) {
      chkJS.disabled = !has_feature("js") || val.isActive;
      chkJS.checked = val.isActive ? has_feature_active("js") : get_feature_pref("js");
      chkJS.onclick = function() {
        self.port.emit("set_feature", {feature: "js", value: chkJS.checked});
      }
    }

    var chkGC = document.getElementById("chkGC");
    if (chkGC) {
      chkGC.disabled = !has_feature("gc") || val.isActive;
      chkGC.checked = get_feature_pref("gc");
      chkGC.onclick = function() {
        self.port.emit("set_feature", {feature: "gc", value: chkGC.checked});
      }
    }

    var chkLayersDump = document.getElementById("chkLayersDump");
    if (chkLayersDump) {
      chkLayersDump.disabled = !has_feature("layersdump") || val.isActive;
      chkLayersDump.checked = get_feature_pref("layersdump");
      chkLayersDump.onclick = function() {
        self.port.emit("set_feature", {feature: "layersdump", value: chkLayersDump.checked});
      }
    }

    var chkDisplayListDump = document.getElementById("chkDisplayListDump");
    if (chkDisplayListDump) {
      chkDisplayListDump.disabled = !has_feature("displaylistdump") || val.isActive;
      chkDisplayListDump.checked = get_feature_pref("displaylistdump");
      chkDisplayListDump.onclick = function() {
        self.port.emit("set_feature", {feature: "displaylistdump", value: chkDisplayListDump.checked});
      }
    }

    var chkMainthreadio = document.getElementById("chkMainthreadio");
    if (chkMainthreadio) {
      chkMainthreadio.disabled = !has_feature("mainthreadio") || val.isActive;
      chkMainthreadio.checked = val.isActive ? has_feature_active("mainthreadio") : get_feature_pref("mainthreadio");
      chkMainthreadio.onclick = function() {
        self.port.emit("set_feature", {feature: "mainthreadio", value: chkMainthreadio.checked});
      }
    }

    document.getElementById("specialOptions").style.display = (val.profilerTargetDescription == "Local") ?
                                                              "" : "none";
    document.getElementById("btnScreencast").style.display = (val.hasScreencast) ?
                                                              "" : "none";

    document.getElementById("lblTargetDesc").textContent = val.profilerTargetDescription;
    if (val.isActive) {
      document.getElementById("spanStart").style.display = 'none';
      document.getElementById("spanStop").style.display = 'inline';
    } else {
      document.getElementById("spanStart").style.display = 'inline';
      document.getElementById("spanStop").style.display = 'none';
    }
    //document.getElementById("divAdb").style.display = get_feature_pref("adb") ? "" : "none";
    document.getElementById("systemLibCache").value = val.systemLibCache;
    document.getElementById("fennecLibCache").value = val.fennecLibCache;
});

function sps_start_profiler() {
  self.port.emit("start_profiler", "test");
}
function sps_stop_profiler() {
  self.port.emit("stop_profiler", "test");
}
document.getElementById("btnStartProfiler").onclick = sps_start_profiler;
document.getElementById("btnStopProfiler").onclick = sps_stop_profiler;

var onShow = {
  "TcpConnect": function() {
    document.getElementById("tcpStatus").innerHTML = "";
  },
  "AdbConnect": function () {
    document.getElementById("adbStatus").innerHTML = "";
  }
}

function showPanel(name) {
    // I'm not sure but sometimes getElementsByClassName doesn't
    // always return the elements I expect.
                 // Why is this needed?
    //var panels = XPCNativeWrapper.unwrap(document.getElementsByClassName("targetPanel"));
    //for (var i = 0; i < panels.length; i++) {
    //    var elem = panels[i];
    //    elem.style.display = "none";
    //}
    // Do this manually until we can figure out getElementsByClassName
    document.getElementById("divTypeTcpConnect").style.display = "none";
    document.getElementById("divTypeAdbConfig").style.display = "none";

    document.getElementById("divTypeControls").style.display = "none";

    document.getElementById("divType" + name).style.display = "";
    if (onShow[name])
      onShow[name]();
}

self.port.on("show_panel", function(val) {
    showPanel(val);
});

self.port.on("show_log", function(val) {
    showPanel("AdbConfig");
    document.getElementById("adbStatus").textContent = val;
});

self.port.on("show_adb_status", function(val) {
  document.getElementById("adbStatus").textContent = val;
});

self.port.on("show_packages", function(val) {
    var pkgs = document.getElementById("fennecPkg");
    // clear the packages list except "auto"
    pkgs.options.length = 1;
    val.forEach(function (val) {
        var opt = document.createElement("option");
        opt.text = val;
        opt.value = val;
        pkgs.options.add(opt);
    });
    pkgs.selectedIndex = pkgs.options.length - 1;
});

function bugzilla_file_bug() {
    self.port.emit("filebug", "test");
}
//document.getElementById("btnFileBug").onclick = bugzilla_file_bug;

function adbConnect() {
    var pkg = document.getElementById("fennecPkg").value;
    var options = {
        systemLibCache: document.getElementById("systemLibCache").value,
        fennecLibCache: document.getElementById("fennecLibCache").value,
        port: document.getElementById("adbPort").value,
        remotePort: document.getElementById("debugPort").value,
        pkg: pkg === "auto" ? null : pkg
    };
    document.getElementById("adbStatus").textContent = "Connecting via adb on port " + options.port + ".";
    self.port.emit("adbconnect", options);
}

document.getElementById("btnAdbConnect").onclick = adbConnect;

function tcpConnect() {
    var options = {
        hostname: document.getElementById("tcpHostname").value,
        port: document.getElementById("tcpPort").value,
    };
    document.getElementById("tcpStatus").textContent = "Connecting to " + options.hostname + ":" + options.port + ".";
    self.port.emit("tcpconnect", options);
}
document.getElementById("btnTcpConnect").onclick = tcpConnect;

function sps_restart() {
    self.port.emit("restart");
}
document.getElementById("btnRestart").onclick = sps_restart;
function sps_screencast() {
    self.port.emit("screencast");
}
document.getElementById("btnScreencast").onclick = sps_screencast;
function sps_save() {
    self.port.emit("getprofile", "test");   
}
document.getElementById("btnSave").onclick = sps_save;
function sps_import() {
    self.port.emit("importpackage", "/tmp/eideticker_profile.zip");   
}
document.getElementById("btnPackage").onclick = sps_import;
function sps_adb_start() {
    self.port.emit("adbstart", "test");
}
document.getElementById("btnStart").onclick = sps_adb_start;
function sps_adb_pull() {
    self.port.emit("adbpull", { });
}
document.getElementById("btnAdb").onclick = sps_adb_pull;
function sps_adb_pull_only_profile() {
    self.port.emit("adbpull", { profileOnly: true });
}
document.getElementById("btnAdbOnlyProfile").onclick = sps_adb_pull_only_profile;
function sps_adb_libs() {
    self.port.emit("adblibs", "test");
}
document.getElementById("btnAdbLibs").onclick = sps_adb_libs;

function open_settings() {
    self.port.emit("opensettings", "");
}
document.getElementById("btnSettings").onclick = open_settings;

function browse_system_lib_folder() {
    self.port.emit("browselibfolder", document.getElementById("systemLibCache").value);
}
document.getElementById("btnALibBrowse").onclick = browse_system_lib_folder;

function browse_fennec_lib_folder() {
    self.port.emit("browselibfolder", document.getElementById("fennecLibCache").value);
}
document.getElementById("btnFLibBrowse").onclick = browse_fennec_lib_folder;

function select_target_change() {
    var value = document.getElementById("selectTarget").value;
    self.port.emit("changetarget", value);
}
document.getElementById("selectTarget").onchange = select_target_change;

