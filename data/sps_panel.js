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

function has_feature(feature) {
  return gFeatureList.indexOf(feature) !== -1;
}
function has_feature_active(feature) {
  return gStartedWithFeatures.indexOf(feature) !== -1;
}
function get_feature_pref(feature) {
      return gFeaturesPrefs[feature] === true;
}

function sps_toggle_active() {
    self.port.emit("toggle", "test");   
}
function sps_get_responsive() {
    self.port.emit("responsive", "test");  
}

self.port.on("onShow", function(val) {
    if (!gUpdateInterval)
        gUpdateInterval = setInterval(sps_get_responsive,50);
});
self.port.on("onHide", function(val) {
    if (gUpdateInterval)
        clearInterval(gUpdateInterval);
    gUpdateInterval = null;
});

self.port.on("change_status", function(val) {
    gStartedWithFeatures = val.startedWithFeatures;
    gFeatureList = val.profilerFeatures;
    gFeaturesPrefs = val.profilerFeaturesPrefs;

    var chkJank = document.getElementById("chkJank");
    if (chkJank) {
      chkJank.disabled = !has_feature("jank") || val.isActive;
      chkJank.checked = has_feature_active("jank");
      chkJank.onclick = function() {
        self.port.emit("set_feature", {feature: "jank", value: chkJank.checked});
      }
    }

    var chkStackwalk = document.getElementById("chkStackwalk");
    if (chkStackwalk) {
      chkStackwalk.disabled = !has_feature("stackwalk") || val.isActive;
      chkStackwalk.checked = has_feature_active("stackwalk");
      chkStackwalk.onclick = function() {
        self.port.emit("set_feature", {feature: "stackwalk", value: chkStackwalk.checked});
      }
    }

    document.getElementById("btnToggleActive").innerHTML = val.runningLabel;
    dump(JSON.stringify(gStartedWithFeatures) + "\n");
    document.getElementById("divAdb").style.visibility = get_feature_pref("adb") ? "" : "hidden";
});
document.getElementById("btnToggleActive").onclick = sps_toggle_active;


function bugzilla_file_bug() {
    self.port.emit("filebug", "test");
}
//document.getElementById("btnFileBug").onclick = bugzilla_file_bug;


function sps_save() {
    self.port.emit("getprofile", "test");   
}
document.getElementById("btnSave").onclick = sps_save;

function open_settings() {
    self.port.emit("opensettings", "");
}
document.getElementById("btnSettings").onclick = open_settings;

self.port.on("getprofile", function(val) {
    document.getElementById("btnToggleActive").innerHTML = "Profile: " + val;
});

self.port.on("responsive", function(val) {
  let canvas = document.getElementsByTagName("canvas")[0];
  var ctx = canvas.getContext("2d");
  ctx.lineWidth = 1;
  reset(ctx, canvas);
  drawGraph(ctx, val, 5, 5, 100, 50);
  drawAxis(ctx, 5, 5, 100, 50);
});

// Plot sizes
var margin = 5;
var height = 50;
var width = 200;

function onClick() {
  // close the plot panel and open a new tab
  postMessage("close");
}

function reset(ctx, canvas) {
  // reset the canvas
     ctx.clearRect(0,0,canvas.width,canvas.height);
     ctx.beginPath();
}

function drawAxis(ctx, x, y, w, h) {
  ctx.strokeStyle = "black";
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y+h);
  ctx.lineTo(x+w, y+h);
  ctx.stroke();
}

function drawGraph(ctx, data, x, y, w, h) {
  ctx.strokeStyle = "green";
  ctx.fillStyle = "#888";
  ctx.beginPath();
  ctx.moveTo(x, y+h);
  
  var max = 100;
  
  for(var i = 0; i < data.length; i++) {
      if (data[i] > 100) data[i] = 100;
  }
  
  for(var i = 0; i < data.length; i++) {
      ctx.lineTo(x+i, y+h-data[i]/max*h);
  }
  
  ctx.lineTo(x+data.length, y+h);
  ctx.lineTo(x, y+h);
  ctx.fill();
  ctx.stroke();
}

