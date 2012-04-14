/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

var tabLastSelected = null;
var gStartedWithFeatures = [];
var gFeatureList = [];
var gFeaturesPrefs = {};

function has_feature(feature) {
    return gFeatureList.indexOf(feature) !== -1;
}
function has_feature_active(feature) {
    return gFeaturesPrefs[feature] === true;
}

self.port.on("change_status", function(val) {
  dump("Got feature change\n");
  gStartedWithFeatures = val.startedWithFeatures;
  gFeatureList = val.profilerFeatures;
  gFeaturesPrefs = val.profilerFeaturesPrefs;
  if (tabLastSelected)
    select_tab(tabLastSelected.id);
});

function select_tab(tabId) {
  if (tabLastSelected) {
    tabLastSelected.classList.remove("selected");
  }
  var tab = document.getElementById(tabId);
  tab.classList.add("selected");
  tabLastSelected = tab;

  var mainAreaDiv = document.getElementById("mainarea");
  mainAreaDiv.innerHTML = "";
  if (tabId === "tabSimple") {
    selectTabSimple(mainAreaDiv);
  } else if (tabId === "tabAdvanced") {
    selectTabAdvanced(mainAreaDiv);
  }
}

var featureDescription = {
  "stackwalk" : "Enable stackwalking in <a href='http://ftp.mozilla.org/pub/mozilla.org/firefox/nightly/latest-profiling/'>profiling-nightly</a> or custom profiling builds. Custom builds should specify: 'ac_add_options --enable-profiling'",
  "jank" : "Only record samples when the application is not responding. Useful for collecting the source of hangs over a large timespan.",
  "adb" : "Profile debug version of fennec, this will not work on nightlies. Install 'adb' on your path, and connect a device via usb debugging.",
};

var rowCount = 0;
function addFeatureDiv(div, name, featureName, desc) {
  var caption = featureDescription[featureName];
  var feature = document.createElement("div");
  div.appendChild(feature);
  feature.className = "settingItem";
  if (rowCount % 2 == 1) {
    feature.classList.add("oddRow");
  }
  rowCount++;
  feature.onmouseover = function() {
    var infoBarDiv = document.getElementById("infobar");
    infoBarDiv.innerHTML = desc;
  };
  
  var featureCheckbox = document.createElement("input");
  featureCheckbox.checked = has_feature_active(featureName);
  featureCheckbox.type = "checkbox";
  feature.appendChild(featureCheckbox);
  var featureText = document.createElement("text");
  feature.appendChild(featureText);
  featureText.textContent = name;
  feature.appendChild(document.createElement("br"));
  feature.appendChild(document.createElement("br"));
  var featureDescriptionNode = document.createElement("text");
  feature.appendChild(featureDescriptionNode);
  featureDescriptionNode.innerHTML = caption;

  featureCheckbox.onclick = function() {
    self.port.emit("set_feature", {feature:featureName, value:featureCheckbox.checked});
  };

  return feature;
}

function selectTabSimple(mainAreaDiv) {
  var featuresDiv = document.createElement("div");
  mainAreaDiv.appendChild(featuresDiv);
  featuresDiv.className = "settingHeader";
  featuresDiv.textContent = "Features";
  rowCount = 0;

  var feature_stackwalking = addFeatureDiv(mainAreaDiv, "Stackwalk", "stackwalk", "Mouse over text");
  var feature_stackwalking = addFeatureDiv(mainAreaDiv, "Jank", "jank", "Mouse over text");
}
function selectTabAdvanced(mainAreaDiv) {
  var featuresDiv = document.createElement("div");
  mainAreaDiv.appendChild(featuresDiv);
  featuresDiv.className = "settingHeader";
  featuresDiv.textContent = "Advanced Features";
  rowCount = 0;

  var feature_stackwalking = addFeatureDiv(mainAreaDiv, "Fennec profiling", "adb", "Mouse over text");
}

document.getElementById('tabSimple').onclick = function() {
  select_tab("tabSimple");
};
document.getElementById('tabAdvanced').onclick = function() {
  select_tab("tabAdvanced");
};
select_tab("tabSimple");
